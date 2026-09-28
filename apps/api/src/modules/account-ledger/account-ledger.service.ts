import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountCreditClassification,
  AccountTransactionReason,
  AccountTransactionStatus,
  AccountTransactionType,
  BillingMode,
  CancellationStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  ServiceRelocationStatus,
  StripeSyncStatus,
  SubscriptionStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { StripeClientService } from '../payments/stripe-client.service';
import type {
  ApproveAccountTransactionDto,
  CreateAccountTransactionDto,
  ReverseAccountTransactionDto,
} from './dto/account-ledger.dto';

const creditStatuses: AccountTransactionStatus[] = [
  AccountTransactionStatus.AVAILABLE,
  AccountTransactionStatus.PARTIALLY_USED,
];

const debitStatuses: AccountTransactionStatus[] = [
  AccountTransactionStatus.APPROVED,
  AccountTransactionStatus.PARTIALLY_USED,
];

const recurringStatuses: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.SUSPENDED,
  SubscriptionStatus.CANCELLATION_PENDING,
  SubscriptionStatus.DISCONNECTION_PENDING,
];

const creditReasons = new Set<AccountTransactionReason>([
  AccountTransactionReason.BILLING_CORRECTION,
  AccountTransactionReason.SERVICE_OUTAGE,
  AccountTransactionReason.CANCELLATION_UNUSED_SERVICE,
  AccountTransactionReason.RELOCATION_SERVICE_GAP,
  AccountTransactionReason.OVERPAYMENT,
  AccountTransactionReason.PLAN_CHANGE_ADJUSTMENT,
  AccountTransactionReason.GOODWILL,
  AccountTransactionReason.OTHER,
]);

const debitReasons = new Set<AccountTransactionReason>([
  AccountTransactionReason.UNDERCHARGE_CORRECTION,
  AccountTransactionReason.INSTALLATION_CHARGE,
  AccountTransactionReason.EQUIPMENT_CHARGE,
  AccountTransactionReason.PLAN_CHANGE_ADJUSTMENT,
  AccountTransactionReason.OTHER,
]);

type DerivedTransaction = {
  amountCents: number;
  customerId: string;
  subscriptionId?: string;
  invoiceId?: string;
  sourceType?: string;
  sourceId?: string;
  deduplicationKey?: string;
  calculation?: Prisma.InputJsonValue;
};

@Injectable()
export class AccountLedgerService {
  private readonly logger = new Logger(AccountLedgerService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    stripeClient: StripeClientService,
  ) {
    this.stripe = stripeClient.client;
  }

  async create(input: CreateAccountTransactionDto, actor: AuthenticatedUser) {
    this.assertReasonAllowed(input.type, input.reason);
    if (input.type === AccountTransactionType.CREDIT && !input.creditClassification) {
      throw new BadRequestException('Credit classification is required.');
    }
    if (input.type === AccountTransactionType.DEBIT && input.creditClassification) {
      throw new BadRequestException('Debit adjustments cannot have a credit classification.');
    }
    const derived = await this.derive(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.accountTransaction.create({
          data: {
            customerId: derived.customerId,
            subscriptionId: derived.subscriptionId,
            invoiceId: derived.invoiceId,
            type: input.type,
            reason: input.reason,
            creditClassification: input.creditClassification,
            suggestedAmountCents: derived.amountCents,
            amountCents: derived.amountCents,
            remainingAmountCents: derived.amountCents,
            description: input.description.trim(),
            internalNote: input.internalNote?.trim(),
            calculation: derived.calculation,
            sourceType: derived.sourceType,
            sourceId: derived.sourceId,
            deduplicationKey: derived.deduplicationKey,
            createdByUserId: actor.id,
          },
          include: { applications: true },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: this.creationAuditAction(input.type, input.reason),
            entityType: 'AccountTransaction',
            entityId: created.id,
            metadata: {
              customerId: created.customerId,
              amountCents: created.amountCents,
              reason: created.reason,
              sourceType: created.sourceType,
              sourceId: created.sourceId,
            },
          },
        });
        return created;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This financial adjustment has already been recorded.');
      }
      throw error;
    }
  }

  async approve(id: string, input: ApproveAccountTransactionDto, actor: AuthenticatedUser) {
    const approved = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockTransaction(transaction, id);
        const current = await transaction.accountTransaction.findUnique({
          where: { id },
          include: { customer: true },
        });
        if (!current) throw new NotFoundException('Account transaction not found.');
        if (current.status !== AccountTransactionStatus.PENDING) {
          throw new ConflictException('Only a pending account transaction can be approved.');
        }
        const requiresStripeSync = await this.requiresStripeSync(
          transaction,
          current.customerId,
          current.subscriptionId,
        );
        const approvedAmountCents = input.approvedAmountCents ?? current.amountCents;
        const updated = await transaction.accountTransaction.update({
          where: { id },
          data: {
            status:
              current.type === AccountTransactionType.CREDIT && !requiresStripeSync
                ? AccountTransactionStatus.AVAILABLE
                : AccountTransactionStatus.APPROVED,
            approvedByUserId: actor.id,
            approvedAt: new Date(),
            approvalNote: input.approvalNote?.trim(),
            amountCents: approvedAmountCents,
            remainingAmountCents: approvedAmountCents,
            stripeSyncStatus: requiresStripeSync
              ? StripeSyncStatus.PENDING
              : StripeSyncStatus.NOT_REQUIRED,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            action:
              current.type === AccountTransactionType.CREDIT
                ? 'ACCOUNT_CREDIT_APPROVED'
                : 'ACCOUNT_DEBIT_APPROVED',
            entityType: 'AccountTransaction',
            entityId: id,
            metadata: {
              suggestedAmountCents: current.suggestedAmountCents ?? current.amountCents,
              approvedAmountCents,
              stripeSyncRequired: requiresStripeSync,
            },
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return approved.stripeSyncStatus === StripeSyncStatus.PENDING
      ? this.synchronizeWithStripe(approved.id)
      : approved;
  }

  async retryStripeSync(id: string) {
    const transaction = await this.prisma.accountTransaction.findUnique({ where: { id } });
    if (!transaction) throw new NotFoundException('Account transaction not found.');
    if (
      transaction.stripeSyncStatus !== StripeSyncStatus.FAILED &&
      transaction.stripeSyncStatus !== StripeSyncStatus.PENDING
    ) {
      throw new ConflictException(
        'This transaction does not require a Stripe synchronization retry.',
      );
    }
    return this.synchronizeWithStripe(id);
  }

  async reverse(id: string, input: ReverseAccountTransactionDto, actor: AuthenticatedUser) {
    const reversal = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockTransaction(transaction, id);
        const current = await transaction.accountTransaction.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Account transaction not found.');
        if (
          current.status === AccountTransactionStatus.PENDING ||
          current.status === AccountTransactionStatus.VOIDED ||
          current.status === AccountTransactionStatus.REVERSED
        ) {
          throw new ConflictException('This account transaction cannot be reversed.');
        }
        const amountCents = current.remainingAmountCents;
        if (amountCents <= 0) {
          throw new ConflictException(
            'This adjustment has already been fully used. Create a reviewed compensating adjustment instead.',
          );
        }
        const oppositeType =
          current.type === AccountTransactionType.CREDIT
            ? AccountTransactionType.DEBIT
            : AccountTransactionType.CREDIT;
        const stripeSyncStatus =
          current.stripeSyncStatus === StripeSyncStatus.SYNCED
            ? StripeSyncStatus.PENDING
            : StripeSyncStatus.NOT_REQUIRED;
        const created = await transaction.accountTransaction.create({
          data: {
            customerId: current.customerId,
            subscriptionId: current.subscriptionId,
            invoiceId: current.invoiceId,
            type: oppositeType,
            reason: AccountTransactionReason.REVERSAL,
            status:
              oppositeType === AccountTransactionType.CREDIT &&
              stripeSyncStatus === StripeSyncStatus.NOT_REQUIRED
                ? AccountTransactionStatus.AVAILABLE
                : AccountTransactionStatus.APPROVED,
            creditClassification:
              oppositeType === AccountTransactionType.CREDIT
                ? AccountCreditClassification.SERVICE_ONLY
                : null,
            amountCents,
            remainingAmountCents: amountCents,
            description: input.description.trim(),
            internalNote: input.internalNote?.trim(),
            sourceType: 'ACCOUNT_TRANSACTION_REVERSAL',
            sourceId: current.id,
            deduplicationKey: `reversal:${current.id}`,
            stripeSyncStatus,
            reversesTransactionId: current.id,
            createdByUserId: actor.id,
            approvedByUserId: actor.id,
            approvedAt: new Date(),
          },
        });
        await transaction.accountTransaction.update({
          where: { id: current.id },
          data: {
            remainingAmountCents: 0,
            status:
              current.type === AccountTransactionType.CREDIT &&
              current.remainingAmountCents === current.amountCents
                ? AccountTransactionStatus.VOIDED
                : AccountTransactionStatus.REVERSED,
            voidedAt: new Date(),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            action:
              current.type === AccountTransactionType.CREDIT
                ? 'ACCOUNT_CREDIT_VOIDED'
                : 'ACCOUNT_DEBIT_REVERSED',
            entityType: 'AccountTransaction',
            entityId: current.id,
            metadata: { reversalTransactionId: created.id, amountCents },
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return reversal.stripeSyncStatus === StripeSyncStatus.PENDING
      ? this.synchronizeWithStripe(reversal.id)
      : reversal;
  }

  async findMine(actor: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');
    const rows = await this.prisma.accountTransaction.findMany({
      where: {
        customerId: customer.id,
        type: AccountTransactionType.CREDIT,
        status: { not: AccountTransactionStatus.PENDING },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        applications: {
          include: { invoice: { select: { invoiceNumber: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      description: row.description,
      amountCents: row.amountCents,
      remainingAmountCents: row.remainingAmountCents,
      currency: row.currency,
      status: row.status,
      creditClassification: row.creditClassification,
      createdAt: row.createdAt,
      applications: row.applications.map((application) => ({
        id: application.id,
        amountCents: application.amountCents,
        invoiceNumber: application.invoice.invoiceNumber,
        createdAt: application.createdAt,
      })),
    }));
  }

  async financeMine(actor: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');
    const summary = await this.financeSummary(customer.id);
    return {
      billingMode: summary.billingMode,
      paymentMethod: summary.paymentMethod,
      nextBillingAt: summary.nextBillingAt,
      regularPlanChargeCents: summary.regularPlanChargeCents,
      availableCreditCents: summary.availableCreditCents,
      outstandingCents: summary.outstandingCents,
      estimatedNextAmountCents: summary.estimatedNextAmountCents,
    };
  }

  async findForCustomer(customerId: string) {
    await this.customerOrThrow(customerId);
    return this.prisma.accountTransaction.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        applications: {
          include: { invoice: { select: { invoiceNumber: true } } },
          orderBy: { createdAt: 'asc' },
        },
        createdBy: { select: { id: true, displayName: true, email: true } },
        approvedBy: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  async financeSummary(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: { in: recurringStatuses } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        invoices: {
          where: { status: { in: ['ISSUED', 'OVERDUE'] } },
          select: { totalCents: true },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const [credit, debit, syncFailures] = await Promise.all([
      this.prisma.accountTransaction.aggregate({
        where: {
          customerId,
          type: AccountTransactionType.CREDIT,
          status: { in: creditStatuses },
        },
        _sum: { remainingAmountCents: true },
      }),
      this.prisma.accountTransaction.aggregate({
        where: {
          customerId,
          type: AccountTransactionType.DEBIT,
          status: { in: debitStatuses },
        },
        _sum: { remainingAmountCents: true },
      }),
      this.prisma.accountTransaction.findMany({
        where: { customerId, stripeSyncStatus: StripeSyncStatus.FAILED },
        select: {
          id: true,
          type: true,
          amountCents: true,
          description: true,
          stripeSyncFailureReason: true,
          stripeSyncAttempts: true,
          stripeLastSyncAttemptAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    const subscription = customer.subscriptions[0] ?? null;
    const availableCreditCents = credit._sum.remainingAmountCents ?? 0;
    const pendingDebitCents = debit._sum.remainingAmountCents ?? 0;
    return {
      billingMode: subscription?.billingMode ?? null,
      paymentMethod: subscription
        ? {
            type: subscription.paymentMethodType,
            brand: subscription.paymentMethodBrand,
            last4: subscription.paymentMethodLast4,
            expMonth: subscription.paymentMethodExpMonth,
            expYear: subscription.paymentMethodExpYear,
          }
        : null,
      nextBillingAt: subscription?.nextBillingAt ?? null,
      regularPlanChargeCents: subscription?.monthlyCents ?? 0,
      availableCreditCents,
      pendingDebitCents,
      outstandingCents: customer.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0),
      estimatedNextAmountCents: Math.max(
        0,
        (subscription?.monthlyCents ?? 0) + pendingDebitCents - availableCreditCents,
      ),
      stripeSyncFailures: syncFailures,
    };
  }

  async recordStripeInvoiceApplication(
    transaction: Prisma.TransactionClient,
    input: {
      customerId: string;
      invoiceId: string;
      stripeInvoiceId: string;
      creditAppliedCents: number;
    },
  ): Promise<{ allocatedCents: number; unallocatedCents: number }> {
    return this.allocateApplications(transaction, {
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      stripeInvoiceId: input.stripeInvoiceId,
      type: AccountTransactionType.CREDIT,
      requestedCents: input.creditAppliedCents,
      syncStatus: StripeSyncStatus.SYNCED,
    });
  }

  async recordStripeInvoiceDebitApplication(
    transaction: Prisma.TransactionClient,
    input: {
      customerId: string;
      invoiceId: string;
      stripeInvoiceId: string;
      debitAppliedCents: number;
    },
  ): Promise<{ allocatedCents: number; unallocatedCents: number }> {
    return this.allocateApplications(transaction, {
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      stripeInvoiceId: input.stripeInvoiceId,
      type: AccountTransactionType.DEBIT,
      requestedCents: input.debitAppliedCents,
      syncStatus: StripeSyncStatus.SYNCED,
    });
  }

  async applyManualInvoiceAdjustments(
    transaction: Prisma.TransactionClient,
    input: {
      customerId: string;
      subscriptionId: string;
      invoiceId: string;
      baseAmountCents: number;
    },
  ): Promise<{ creditAppliedCents: number; debitAppliedCents: number }> {
    const debit = await this.allocateApplications(transaction, {
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      type: AccountTransactionType.DEBIT,
      requestedCents: Number.MAX_SAFE_INTEGER,
      syncStatus: StripeSyncStatus.NOT_REQUIRED,
    });
    const credit = await this.allocateApplications(transaction, {
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      type: AccountTransactionType.CREDIT,
      requestedCents: input.baseAmountCents + debit.allocatedCents,
      syncStatus: StripeSyncStatus.NOT_REQUIRED,
    });
    return {
      creditAppliedCents: credit.allocatedCents,
      debitAppliedCents: debit.allocatedCents,
    };
  }

  private async allocateApplications(
    transaction: Prisma.TransactionClient,
    input: {
      customerId: string;
      subscriptionId?: string;
      invoiceId: string;
      stripeInvoiceId?: string;
      type: AccountTransactionType;
      requestedCents: number;
      syncStatus: StripeSyncStatus;
    },
  ): Promise<{ allocatedCents: number; unallocatedCents: number }> {
    if (input.requestedCents <= 0) return { allocatedCents: 0, unallocatedCents: 0 };
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(CAST(${input.customerId} AS text), 17))::text AS lock`;
    const existing = await transaction.creditApplication.aggregate({
      where: {
        invoiceId: input.invoiceId,
        accountTransaction: { type: input.type },
      },
      _sum: { amountCents: true },
    });
    let remaining = Math.max(0, input.requestedCents - (existing._sum.amountCents ?? 0));
    const adjustments = await transaction.accountTransaction.findMany({
      where: {
        customerId: input.customerId,
        type: input.type,
        status: {
          in: input.type === AccountTransactionType.CREDIT ? creditStatuses : debitStatuses,
        },
        stripeSyncStatus: input.syncStatus,
        remainingAmountCents: { gt: 0 },
        ...(input.subscriptionId
          ? { OR: [{ subscriptionId: null }, { subscriptionId: input.subscriptionId }] }
          : {}),
      },
      orderBy: [{ approvedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    let allocatedCents = 0;
    for (const adjustment of adjustments) {
      if (remaining <= 0) break;
      const amountCents = Math.min(remaining, adjustment.remainingAmountCents);
      const nextRemaining = adjustment.remainingAmountCents - amountCents;
      await transaction.creditApplication.create({
        data: {
          accountTransactionId: adjustment.id,
          invoiceId: input.invoiceId,
          amountCents,
          stripeInvoiceId: input.stripeInvoiceId,
        },
      });
      await transaction.accountTransaction.update({
        where: { id: adjustment.id },
        data: {
          remainingAmountCents: nextRemaining,
          status:
            nextRemaining === 0
              ? AccountTransactionStatus.USED
              : AccountTransactionStatus.PARTIALLY_USED,
        },
      });
      await transaction.auditLog.create({
        data: {
          action:
            input.type === AccountTransactionType.CREDIT
              ? 'ACCOUNT_CREDIT_APPLIED'
              : 'ACCOUNT_DEBIT_APPLIED',
          entityType: 'AccountTransaction',
          entityId: adjustment.id,
          metadata: {
            invoiceId: input.invoiceId,
            stripeInvoiceId: input.stripeInvoiceId ?? null,
            amountCents,
          },
        },
      });
      remaining -= amountCents;
      allocatedCents += amountCents;
    }
    return { allocatedCents, unallocatedCents: remaining };
  }

  private async synchronizeWithStripe(id: string) {
    const record = await this.prisma.accountTransaction.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!record) throw new NotFoundException('Account transaction not found.');
    if (record.stripeSyncStatus === StripeSyncStatus.SYNCED) return record;
    if (!record.customer.stripeCustomerId) {
      return this.markSyncFailed(id, 'The customer does not have a Stripe customer reference.');
    }
    await this.prisma.accountTransaction.update({
      where: { id },
      data: {
        stripeSyncStatus: StripeSyncStatus.PENDING,
        stripeSyncAttempts: { increment: 1 },
        stripeLastSyncAttemptAt: new Date(),
        stripeSyncFailureReason: null,
      },
    });
    try {
      const stripeTransaction = await this.stripe.customers.createBalanceTransaction(
        record.customer.stripeCustomerId,
        {
          amount:
            record.type === AccountTransactionType.CREDIT
              ? -record.amountCents
              : record.amountCents,
          currency: record.currency.toLowerCase(),
          description: record.description,
          metadata: {
            meroAccountTransactionId: record.id,
            meroCustomerId: record.customerId,
            reason: record.reason,
          },
        },
        { idempotencyKey: `account-transaction-${record.id}` },
      );
      return await this.prisma.$transaction(async (transaction) => {
        const synced = await transaction.accountTransaction.update({
          where: { id },
          data: {
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeBalanceTransactionId: stripeTransaction.id,
            stripeSyncFailureReason: null,
            stripeSyncedAt: new Date(),
            status:
              record.type === AccountTransactionType.CREDIT
                ? AccountTransactionStatus.AVAILABLE
                : AccountTransactionStatus.APPROVED,
          },
        });
        await transaction.auditLog.create({
          data: {
            action:
              record.type === AccountTransactionType.CREDIT
                ? 'ACCOUNT_CREDIT_SYNCED_TO_STRIPE'
                : 'ACCOUNT_DEBIT_SYNCED_TO_STRIPE',
            entityType: 'AccountTransaction',
            entityId: id,
            metadata: { stripeBalanceTransactionId: stripeTransaction.id },
          },
        });
        return synced;
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'account_transaction.stripe_sync_failed',
          accountTransactionId: id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return this.markSyncFailed(
        id,
        error instanceof Error ? error.message.slice(0, 500) : 'Stripe synchronization failed.',
      );
    }
  }

  private async markSyncFailed(id: string, reason: string) {
    return this.prisma.$transaction(async (transaction) => {
      const failed = await transaction.accountTransaction.update({
        where: { id },
        data: {
          stripeSyncStatus: StripeSyncStatus.FAILED,
          stripeSyncFailureReason: reason,
          stripeLastSyncAttemptAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'ACCOUNT_CREDIT_SYNC_FAILED',
          entityType: 'AccountTransaction',
          entityId: id,
          metadata: { reason },
        },
      });
      return failed;
    });
  }

  private async derive(input: CreateAccountTransactionDto): Promise<DerivedTransaction> {
    await this.customerOrThrow(input.customerId);
    if (input.subscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { id: input.subscriptionId, customerId: input.customerId },
      });
      if (!subscription) throw new BadRequestException('Subscription does not belong to customer.');
    }
    if (input.invoiceId) {
      const invoice = await this.prisma.invoice.findFirst({
        where: { id: input.invoiceId, customerId: input.customerId },
      });
      if (!invoice) throw new BadRequestException('Invoice does not belong to customer.');
    }

    if (input.reason === AccountTransactionReason.BILLING_CORRECTION) {
      if (!input.invoiceId) {
        throw new BadRequestException('Billing correction credits require an invoice.');
      }
      const incorrect = this.calculationCents(input.calculation, 'incorrectEligibleChargeCents');
      const correct = this.calculationCents(input.calculation, 'correctEligibleChargeCents');
      const calculated = incorrect !== null && correct !== null ? incorrect - correct : null;
      const amountCents = calculated ?? input.amountCents;
      if (
        !amountCents ||
        amountCents <= 0 ||
        (input.amountCents && calculated !== null && input.amountCents !== calculated)
      ) {
        throw new BadRequestException('Billing correction amount does not match its calculation.');
      }
      return {
        ...this.baseDerived(input, amountCents),
        sourceType: input.sourceType ?? 'INVOICE',
        sourceId: input.sourceId ?? input.invoiceId,
        deduplicationKey: `${input.type}:${input.reason}:invoice:${input.invoiceId}`,
      };
    }

    if (input.reason === AccountTransactionReason.CANCELLATION_UNUSED_SERVICE) {
      if (!input.sourceId) {
        throw new BadRequestException('Cancellation credit requires a cancellation request.');
      }
      const cancellation = await this.prisma.cancellationRequest.findFirst({
        where: { id: input.sourceId, customerId: input.customerId },
        include: { refund: true },
      });
      if (!cancellation || cancellation.status !== CancellationStatus.COMPLETED) {
        throw new BadRequestException(
          'Cancellation must be completed before credit is calculated.',
        );
      }
      if (
        cancellation.refund &&
        cancellation.refund.status !== RefundStatus.REJECTED &&
        cancellation.refund.status !== RefundStatus.CANCELLED &&
        cancellation.refund.status !== RefundStatus.FAILED
      ) {
        throw new ConflictException('The cancellation value is already reserved for a refund.');
      }
      if (cancellation.refundAmountCents <= 0) {
        throw new BadRequestException('This cancellation has no eligible unused-service value.');
      }
      return {
        amountCents: cancellation.refundAmountCents,
        customerId: input.customerId,
        subscriptionId: cancellation.subscriptionId,
        sourceType: 'CANCELLATION_REQUEST',
        sourceId: cancellation.id,
        deduplicationKey: `credit:cancellation:${cancellation.id}`,
        calculation: cancellation.refundCalculation ?? {
          effectiveAt: cancellation.effectiveAt.toISOString(),
        },
      };
    }

    if (input.reason === AccountTransactionReason.RELOCATION_SERVICE_GAP) {
      if (!input.sourceId) {
        throw new BadRequestException('Relocation credit requires a relocation reference.');
      }
      const relocation = await this.prisma.serviceRelocation.findFirst({
        where: { id: input.sourceId, customerId: input.customerId },
        include: { subscription: true },
      });
      if (
        !relocation ||
        relocation.status !== ServiceRelocationStatus.COMPLETED ||
        !relocation.oldServiceDisconnectedAt ||
        !relocation.newServiceActivatedAt
      ) {
        throw new BadRequestException(
          'Relocation must be completed with actual disconnection and activation dates.',
        );
      }
      const dayMs = 86_400_000;
      const gapMilliseconds = Math.max(
        0,
        relocation.newServiceActivatedAt.getTime() -
          relocation.oldServiceDisconnectedAt.getTime() -
          dayMs,
      );
      const periodMilliseconds =
        relocation.subscription.currentPeriodEnd.getTime() -
        relocation.subscription.currentPeriodStart.getTime();
      const amountCents = this.proratedCents(
        relocation.subscription.monthlyCents,
        gapMilliseconds,
        periodMilliseconds,
      );
      if (amountCents <= 0) {
        throw new BadRequestException('The confirmed relocation has no eligible service gap.');
      }
      return {
        amountCents,
        customerId: input.customerId,
        subscriptionId: relocation.subscriptionId,
        sourceType: 'SERVICE_RELOCATION',
        sourceId: relocation.id,
        deduplicationKey: `credit:relocation:${relocation.id}`,
        calculation: {
          oldServiceEndDate: relocation.oldServiceDisconnectedAt.toISOString(),
          newServiceActivationDate: relocation.newServiceActivatedAt.toISOString(),
          eligibleGapMilliseconds: gapMilliseconds,
          billingPeriodMilliseconds: periodMilliseconds,
          monthlyCents: relocation.subscription.monthlyCents,
        },
      };
    }

    if (input.reason === AccountTransactionReason.OVERPAYMENT) {
      if (!input.sourceId) throw new BadRequestException('Overpayment credit requires a payment.');
      const payment = await this.prisma.payment.findFirst({
        where: {
          id: input.sourceId,
          customerId: input.customerId,
          status: PaymentStatus.SUCCEEDED,
        },
        include: { invoice: true },
      });
      if (!payment) throw new BadRequestException('Successful source payment not found.');
      const amountCents = payment.amountCents - payment.invoice.totalCents;
      if (amountCents <= 0) throw new BadRequestException('The payment is not an overpayment.');
      return {
        amountCents,
        customerId: input.customerId,
        subscriptionId: payment.invoice.subscriptionId ?? undefined,
        invoiceId: payment.invoiceId,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        deduplicationKey: `credit:overpayment:${payment.id}`,
        calculation: {
          amountReceivedCents: payment.amountCents,
          amountOwedCents: payment.invoice.totalCents,
        },
      };
    }

    if (input.reason === AccountTransactionReason.SERVICE_OUTAGE && !input.sourceId) {
      throw new BadRequestException('Outage credit requires a unique fault or outage reference.');
    }
    if (input.type === AccountTransactionType.DEBIT && !input.sourceId) {
      throw new BadRequestException('Debit adjustments require a source reference.');
    }
    if (!input.amountCents || input.amountCents <= 0) {
      throw new BadRequestException('A positive adjustment amount is required.');
    }
    return this.baseDerived(input, input.amountCents);
  }

  private baseDerived(input: CreateAccountTransactionDto, amountCents: number): DerivedTransaction {
    const sourceId = input.sourceId?.trim();
    const sourceType = input.sourceType?.trim() || (sourceId ? input.reason : undefined);
    return {
      amountCents,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      sourceType,
      sourceId,
      deduplicationKey:
        sourceType && sourceId
          ? `${input.type}:${input.reason}:${sourceType}:${sourceId}`.toLowerCase()
          : undefined,
      calculation: input.calculation as Prisma.InputJsonValue | undefined,
    };
  }

  private async requiresStripeSync(
    transaction: Prisma.TransactionClient,
    customerId: string,
    subscriptionId: string | null,
  ): Promise<boolean> {
    return Boolean(
      await transaction.subscription.findFirst({
        where: {
          id: subscriptionId ?? undefined,
          customerId,
          billingMode: BillingMode.STRIPE_RECURRING,
          status: { in: recurringStatuses },
        },
        select: { id: true },
      }),
    );
  }

  private customerOrThrow(customerId: string) {
    return this.prisma.customer
      .findUnique({ where: { id: customerId } })
      .then((customer) => customer ?? Promise.reject(new NotFoundException('Customer not found.')));
  }

  private lockTransaction(transaction: Prisma.TransactionClient, id: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(CAST(${id} AS text), 19))::text AS lock`;
  }

  private calculationCents(
    calculation: Record<string, unknown> | undefined,
    key: string,
  ): number | null {
    const value = calculation?.[key];
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  }

  private proratedCents(amountCents: number, numerator: number, denominator: number): number {
    if (
      !Number.isSafeInteger(amountCents) ||
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      amountCents <= 0 ||
      numerator <= 0 ||
      denominator <= 0
    ) {
      return 0;
    }
    return Number(
      (BigInt(amountCents) * BigInt(numerator) + BigInt(denominator) / 2n) / BigInt(denominator),
    );
  }

  private creationAuditAction(
    type: AccountTransactionType,
    reason: AccountTransactionReason,
  ): string {
    if (type === AccountTransactionType.DEBIT) return 'ACCOUNT_DEBIT_CREATED';
    const sourceActions: Partial<Record<AccountTransactionReason, string>> = {
      [AccountTransactionReason.CANCELLATION_UNUSED_SERVICE]: 'CANCELLATION_CREDIT_CREATED',
      [AccountTransactionReason.RELOCATION_SERVICE_GAP]: 'RELOCATION_CREDIT_CREATED',
      [AccountTransactionReason.SERVICE_OUTAGE]: 'OUTAGE_CREDIT_CREATED',
      [AccountTransactionReason.OVERPAYMENT]: 'OVERPAYMENT_CREDIT_CREATED',
    };
    return sourceActions[reason] ?? 'ACCOUNT_CREDIT_CREATED';
  }

  private assertReasonAllowed(
    type: AccountTransactionType,
    reason: AccountTransactionReason,
  ): void {
    const allowed = type === AccountTransactionType.CREDIT ? creditReasons : debitReasons;
    if (!allowed.has(reason)) {
      throw new BadRequestException(
        `${reason.replaceAll('_', ' ').toLowerCase()} is not a valid ${type.toLowerCase()} reason.`,
      );
    }
  }
}
