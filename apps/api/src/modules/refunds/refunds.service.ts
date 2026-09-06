import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RefundStatus, RefundType, Role } from '@prisma/client';
import type Stripe from 'stripe';

import { PrismaService } from '../../database/prisma.service';
import { amountRange, buildPaginationMeta, dateRange } from '../../common/pagination';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { NotificationService } from '../notifications/notification.service';
import type {
  ApproveRefundDto,
  CancelRefundDto,
  CreateAdminRefundDto,
  RefundQueryDto,
  RejectRefundDto,
  RequestRefundDto,
  ReviewRefundDto,
} from './dto/refund.dto';
import { RefundPolicyService } from './refund-policy.service';
import { RefundReconciliationService } from './refund-reconciliation.service';
import { StripeRefundService } from './stripe-refund.service';
import { RefundAttachmentsService } from './refund-attachments.service';
import type { UploadedRefundFile } from './refund-attachment.types';

const refundInclude = {
  customer: {
    select: {
      id: true,
      customerNumber: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  payment: {
    select: {
      id: true,
      amountCents: true,
      refundedCents: true,
      currency: true,
      status: true,
      paidAt: true,
      providerPaymentId: true,
    },
  },
  invoice: { select: { id: true, invoiceNumber: true, totalCents: true, status: true } },
  subscription: {
    select: { id: true, status: true, plan: { select: { id: true, name: true } } },
  },
  requestedBy: { select: { id: true, email: true, displayName: true, role: true } },
  approvedBy: { select: { id: true, email: true, displayName: true, role: true } },
  processedBy: { select: { id: true, email: true, displayName: true, role: true } },
  rejectedBy: { select: { id: true, email: true, displayName: true, role: true } },
  attachments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      refundId: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      uploadedByRole: true,
      createdAt: true,
      uploadedBy: { select: { email: true, displayName: true } },
    },
  },
} satisfies Prisma.RefundInclude;

type RefundDetail = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: RefundPolicyService,
    private readonly reconciliation: RefundReconciliationService,
    private readonly stripeRefunds: StripeRefundService,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly attachments: RefundAttachmentsService,
  ) {}

  async request(
    paymentId: string,
    input: RequestRefundDto,
    actor: AuthenticatedUser,
    files: UploadedRefundFile[] = [],
  ) {
    await this.attachments.validate(files);
    const customer = await this.prisma.customer.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');

    const refund = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockPayment(transaction, paymentId);
        const payment = await transaction.payment.findFirst({
          where: { id: paymentId, customerId: customer.id },
          include: { invoice: { select: { id: true, subscriptionId: true } } },
        });
        if (!payment) throw new NotFoundException('Payment not found.');
        this.policy.assertCustomerRequestEligible(payment);

        const activeRequest = await transaction.refund.findFirst({
          where: {
            paymentId,
            status: {
              in: [
                RefundStatus.REQUESTED,
                RefundStatus.UNDER_REVIEW,
                RefundStatus.MORE_INFORMATION_REQUIRED,
                RefundStatus.APPROVED,
                RefundStatus.PROCESSING,
              ],
            },
          },
          select: { id: true },
        });
        if (activeRequest) {
          this.policy.conflict(
            'REFUND_REQUEST_ALREADY_EXISTS',
            'A refund request for this payment is already being processed.',
          );
        }
        const available = await this.availableCents(transaction, paymentId);
        if (available <= 0) {
          this.policy.conflict(
            'REFUND_ALREADY_FULLY_REFUNDED',
            'This payment has no remaining refundable value.',
          );
        }
        const created = await transaction.refund.create({
          data: {
            customerId: customer.id,
            paymentId: payment.id,
            invoiceId: payment.invoice.id,
            subscriptionId: payment.invoice.subscriptionId,
            stripePaymentIntentId: payment.providerPaymentId!,
            originalAmountCents: payment.amountCents,
            refundAmountCents: available,
            currency: payment.currency,
            type: RefundType.FULL,
            reason: input.reason,
            customerReason: input.details?.trim() || null,
            requestedByUserId: actor.id,
          },
          include: refundInclude,
        });
        await this.attachments.createForRefund(transaction, created.id, actor, files);
        await this.audit(
          transaction,
          created.id,
          actor.id,
          'REFUND_REQUESTED',
          null,
          created.status,
          {
            paymentId,
            invoiceId: created.invoiceId,
            customerId: customer.id,
            amountCents: created.refundAmountCents,
            reason: created.reason,
          },
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const hydrated = await this.refundOrThrow(refund.id);
    this.log('refund.request.created', hydrated);
    await this.notifySafely(() => this.notifications.sendRefundRequested(this.emailData(hydrated)));
    return this.customerView(hydrated);
  }

  async createAdministrative(input: CreateAdminRefundDto, actor: AuthenticatedUser) {
    this.policy.assertCanApprove(actor.role);
    const refund = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockPayment(transaction, input.paymentId);
        const payment = await transaction.payment.findUnique({
          where: { id: input.paymentId },
          include: {
            invoice: { select: { id: true, subscriptionId: true } },
          },
        });
        if (!payment) throw new NotFoundException('Payment not found.');
        this.policy.assertCustomerRequestEligible(payment);
        const active = await transaction.refund.findFirst({
          where: {
            paymentId: payment.id,
            status: {
              in: [
                RefundStatus.REQUESTED,
                RefundStatus.UNDER_REVIEW,
                RefundStatus.MORE_INFORMATION_REQUIRED,
                RefundStatus.APPROVED,
                RefundStatus.PROCESSING,
              ],
            },
          },
          select: { id: true },
        });
        if (active) {
          this.policy.conflict(
            'REFUND_REQUEST_ALREADY_EXISTS',
            'A refund request for this payment is already being processed.',
          );
        }
        const available = await this.availableCents(transaction, payment.id);
        if (available <= 0) {
          this.policy.conflict(
            'REFUND_ALREADY_FULLY_REFUNDED',
            'This payment has no remaining refundable value.',
          );
        }
        const created = await transaction.refund.create({
          data: {
            customerId: payment.customerId,
            paymentId: payment.id,
            invoiceId: payment.invoice.id,
            subscriptionId: payment.invoice.subscriptionId,
            stripePaymentIntentId: payment.providerPaymentId!,
            originalAmountCents: payment.amountCents,
            refundAmountCents: available,
            currency: payment.currency,
            type: RefundType.FULL,
            reason: input.reason,
            customerReason: input.details?.trim() || null,
            internalNote: input.internalNote?.trim() || null,
            requestedByUserId: actor.id,
          },
          include: refundInclude,
        });
        await this.audit(
          transaction,
          created.id,
          actor.id,
          'REFUND_REQUESTED',
          null,
          created.status,
          {
            paymentId: payment.id,
            invoiceId: payment.invoice.id,
            customerId: payment.customerId,
            amountCents: available,
            reason: input.reason,
            administrativeRequest: true,
          },
        );
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.log('refund.request.created', refund);
    await this.notifySafely(() => this.notifications.sendRefundRequested(this.emailData(refund)));
    return refund;
  }

  async findMine(query: RefundQueryDto, actor: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');
    const where: Prisma.RefundWhereInput = {
      customerId: customer.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: refundInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return {
      data: data.map((refund) => this.customerView(refund)),
      meta: this.pagination(query, total),
    };
  }

  async findMineOne(id: string, actor: AuthenticatedUser) {
    const refund = await this.prisma.refund.findFirst({
      where: { id, customer: { userId: actor.id } },
      include: refundInclude,
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    return this.customerView(refund);
  }

  async findAll(query: RefundQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.RefundWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.dateFrom || query.dateTo
        ? { requestedAt: dateRange(query.dateFrom, query.dateTo) }
        : {}),
      ...(query.minAmount !== undefined || query.maxAmount !== undefined
        ? { refundAmountCents: amountRange(query.minAmount, query.maxAmount) }
        : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(search
        ? {
            OR: [
              ...(this.uuidSearch(search) ? [{ id: search }] : []),
              { stripePaymentIntentId: { contains: search, mode: 'insensitive' as const } },
              { stripeRefundId: { contains: search, mode: 'insensitive' as const } },
              { stripeChargeId: { contains: search, mode: 'insensitive' as const } },
              { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' as const } } },
              { customer: { firstName: { contains: search, mode: 'insensitive' as const } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' as const } } },
              { customer: { email: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: [{ [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(query, total) };
  }

  async findOne(id: string) {
    const refund = await this.refundOrThrow(id);
    const [totals, auditTimeline] = await Promise.all([
      this.reconciliation.totals(refund.paymentId),
      this.prisma.auditLog.findMany({
        where: { entityType: 'Refund', entityId: id },
        include: { actor: { select: { email: true, displayName: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { ...refund, refundableSummary: totals, auditTimeline };
  }

  async review(id: string, input: ReviewRefundDto, actor: AuthenticatedUser) {
    const current = await this.prisma.refund.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Refund not found.');
    if (current.status === RefundStatus.UNDER_REVIEW) {
      if (!input.internalNote?.trim()) {
        throw new BadRequestException('An internal note is required to update this review.');
      }
      return this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.refund.update({
          where: { id },
          data: { internalNote: input.internalNote?.trim() },
          include: refundInclude,
        });
        await this.audit(
          transaction,
          id,
          actor.id,
          'REFUND_REVIEW_NOTE_ADDED',
          current.status,
          current.status,
          { paymentId: current.paymentId, amountCents: current.refundAmountCents },
        );
        return updated;
      });
    }
    return this.transition(id, RefundStatus.UNDER_REVIEW, actor, {
      internalNote: input.internalNote?.trim() || undefined,
      action: 'REFUND_REVIEW_STARTED',
    });
  }

  async requestMoreInformation(
    id: string,
    message: string,
    actor: AuthenticatedUser,
  ): Promise<RefundDetail> {
    const trimmed = message.trim();
    if (!trimmed)
      throw new BadRequestException('A message is required when requesting more information.');
    const current = await this.prisma.refund.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Refund not found.');
    this.policy.assertTransition(current.status, RefundStatus.MORE_INFORMATION_REQUIRED);
    const refund = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.refund.update({
        where: { id },
        data: { status: RefundStatus.MORE_INFORMATION_REQUIRED, customerMessage: trimmed },
        include: refundInclude,
      });
      await this.audit(
        transaction,
        id,
        actor.id,
        'REFUND_MORE_INFORMATION_REQUESTED',
        current.status,
        updated.status,
        {
          paymentId: current.paymentId,
          message: trimmed,
        },
      );
      return updated;
    });
    await this.notifySafely(() =>
      this.notifications.sendRefundMoreInformation(this.emailData(refund)),
    );
    return refund;
  }

  async approve(id: string, input: ApproveRefundDto, actor: AuthenticatedUser) {
    this.policy.assertCanApprove(actor.role, input.overrideReason);
    const refund = await this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.refund.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Refund not found.');
        await this.lockPayment(transaction, existing.paymentId);
        this.policy.assertTransition(existing.status, RefundStatus.APPROVED);
        const available = await this.availableCents(transaction, existing.paymentId, existing.id);
        const amount = input.type === RefundType.FULL ? available : input.amountCents;
        if (input.type === RefundType.PARTIAL && !amount) {
          throw new BadRequestException({
            code: 'REFUND_AMOUNT_REQUIRED',
            message: 'A partial refund amount is required.',
          });
        }
        if (!Number.isSafeInteger(amount) || !amount || amount <= 0 || amount > available) {
          this.policy.conflict(
            'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
            `The refund cannot exceed the remaining refundable amount of ${available} cents.`,
          );
        }
        const updated = await transaction.refund.update({
          where: { id },
          data: {
            status: RefundStatus.APPROVED,
            type: input.type,
            reason: input.reason ?? existing.reason,
            refundAmountCents: amount,
            internalNote: input.internalNote?.trim() || existing.internalNote,
            approvedByUserId: actor.id,
            approvedAt: new Date(),
            failureReason: null,
            failedAt: null,
            metadata: input.overrideReason
              ? { overrideReason: input.overrideReason.trim() }
              : (existing.metadata ?? undefined),
          },
          include: refundInclude,
        });
        await this.audit(
          transaction,
          id,
          actor.id,
          input.overrideReason ? 'REFUND_OVERRIDE_USED' : 'REFUND_APPROVED',
          existing.status,
          updated.status,
          {
            paymentId: updated.paymentId,
            amountCents: updated.refundAmountCents,
            reason: updated.reason,
            overrideReason: input.overrideReason,
          },
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.log('refund.approved', refund);
    await this.notifySafely(() => this.notifications.sendRefundApproved(this.emailData(refund)));
    return refund;
  }

  async reject(id: string, input: RejectRefundDto, actor: AuthenticatedUser) {
    this.policy.assertCanApprove(actor.role);
    const refund = await this.transition(id, RefundStatus.REJECTED, actor, {
      internalNote: input.internalNote.trim(),
      action: 'REFUND_REJECTED',
      rejected: true,
    });
    await this.notifySafely(() => this.notifications.sendRefundRejected(this.emailData(refund)));
    return refund;
  }

  async cancel(id: string, input: CancelRefundDto, actor: AuthenticatedUser) {
    const existing = await this.prisma.refund.findUnique({
      where: { id },
      include: { customer: { select: { userId: true } } },
    });
    if (!existing) throw new NotFoundException('Refund not found.');
    if (actor.role === Role.CUSTOMER && existing.customer.userId !== actor.id) {
      throw new NotFoundException('Refund not found.');
    }
    return this.transition(id, RefundStatus.CANCELLED, actor, {
      internalNote: actor.role === Role.CUSTOMER ? undefined : input.reason?.trim(),
      action: 'REFUND_CANCELLED',
    });
  }

  async process(id: string, actor: AuthenticatedUser) {
    this.policy.assertCanProcess(actor.role);
    const before = await this.refundOrThrow(id);
    if (before.status === RefundStatus.FAILED && before.stripeRefundId) {
      const remote = await this.stripeRefunds.retrieve(before.stripeRefundId);
      if (remote.status === 'succeeded') {
        await this.reconcileStripeRefund(
          `server-refund-reconcile-${remote.id}-${Date.now()}`,
          'server.refund_reconciliation',
          remote,
        );
        return this.refundOrThrow(id);
      }
      if (remote.status !== 'failed' && remote.status !== 'canceled') {
        this.policy.conflict(
          'REFUND_ALREADY_PROCESSING',
          'Stripe is still processing this refund. Retry after its status changes.',
        );
      }
    }

    const refund = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockPayment(transaction, before.paymentId);
        const current = await transaction.refund.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Refund not found.');
        this.policy.assertTransition(current.status, RefundStatus.PROCESSING);
        const available = await this.availableCents(transaction, current.paymentId, current.id);
        if (current.refundAmountCents > available) {
          this.policy.conflict(
            'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
            'The approved amount is no longer refundable.',
          );
        }
        const updated = await transaction.refund.update({
          where: { id },
          data: {
            status: RefundStatus.PROCESSING,
            processedByUserId: actor.id,
            processingAttempt: { increment: 1 },
            stripeRefundId: null,
            stripeChargeId: null,
            failureReason: null,
            failedAt: null,
          },
          include: refundInclude,
        });
        await this.audit(
          transaction,
          id,
          actor.id,
          current.status === RefundStatus.FAILED ? 'REFUND_RETRY_REQUESTED' : 'REFUND_PROCESSING',
          current.status,
          updated.status,
          { paymentId: updated.paymentId, amountCents: updated.refundAmountCents },
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.log('refund.processing.started', refund);

    try {
      const stripeRefund = await this.stripeRefunds.create({
        refundId: refund.id,
        paymentIntentId: refund.stripePaymentIntentId,
        amountCents: refund.refundAmountCents,
        reason: refund.reason,
        customerId: refund.customerId,
        paymentId: refund.paymentId,
        invoiceId: refund.invoiceId,
        processingAttempt: refund.processingAttempt,
      });
      await this.prisma.refund.updateMany({
        where: { id, status: RefundStatus.PROCESSING, processingAttempt: refund.processingAttempt },
        data: {
          stripeRefundId: stripeRefund.id,
          stripeChargeId:
            typeof stripeRefund.charge === 'string' ? stripeRefund.charge : stripeRefund.charge?.id,
        },
      });
      this.log('refund.stripe.created', { ...refund, stripeRefundId: stripeRefund.id });
      if (stripeRefund.status === 'failed' || stripeRefund.status === 'canceled') {
        await this.reconcileStripeRefund(
          `server-refund-failed-${stripeRefund.id}-${refund.processingAttempt}`,
          'server.refund_failed',
          stripeRefund,
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'refund.stripe.create_failed',
          refundId: id,
          error: this.errorName(error),
        }),
      );
      await this.failProcessing(id, actor.id, 'Stripe could not accept this refund request.');
      const failedRefund = await this.refundOrThrow(id);
      await this.notifySafely(() =>
        this.notifications.sendRefundFailed(this.emailData(failedRefund)),
      );
      throw new ConflictException({
        code: 'REFUND_STRIPE_PROCESSING_FAILED',
        message: 'The refund could not be submitted. It was recorded as failed and can be retried.',
      });
    }
    await this.dashboardCache.invalidate();
    return this.findOne(id);
  }

  /**
   * Re-check refunds that have been waiting for a provider webhook longer than
   * the configured grace period. Stripe webhooks are the primary source of
   * truth, but this makes missed deliveries recoverable instead of leaving a
   * refund permanently stuck in PROCESSING.
   */
  async reconcileStaleProcessingRefunds(cutoff: Date, batchSize: number) {
    const candidates = await this.prisma.refund.findMany({
      where: {
        status: RefundStatus.PROCESSING,
        updatedAt: { lt: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: {
        id: true,
        stripeRefundId: true,
        updatedAt: true,
      },
    });
    const summary = {
      scanned: candidates.length,
      reconciled: 0,
      stillProcessing: 0,
      failed: 0,
      issues: [] as Array<{
        refundId: string;
        stripeRefundId: string | null;
        reason: string;
      }>,
    };

    for (const candidate of candidates) {
      if (!candidate.stripeRefundId) {
        summary.issues.push({
          refundId: candidate.id,
          stripeRefundId: null,
          reason: 'Stripe refund ID is missing; manual review is required.',
        });
        continue;
      }
      try {
        const remote = await this.stripeRefunds.retrieve(candidate.stripeRefundId);
        if (
          remote.status === 'succeeded' ||
          remote.status === 'failed' ||
          remote.status === 'canceled'
        ) {
          await this.reconcileStripeRefund(
            `server-refund-reconciliation-${candidate.id}-${remote.id}-${remote.status}`,
            remote.status === 'failed' || remote.status === 'canceled'
              ? 'refund.failed'
              : 'refund.updated',
            remote,
          );
          summary.reconciled += 1;
        } else {
          summary.stillProcessing += 1;
          summary.issues.push({
            refundId: candidate.id,
            stripeRefundId: candidate.stripeRefundId,
            reason: `Stripe still reports status ${remote.status ?? 'unknown'}.`,
          });
        }
      } catch (error: unknown) {
        summary.failed += 1;
        summary.issues.push({
          refundId: candidate.id,
          stripeRefundId: candidate.stripeRefundId,
          reason: `Stripe reconciliation failed: ${this.errorName(error)}.`,
        });
        this.logger.error(
          JSON.stringify({
            event: 'refund.reconciliation_failed',
            refundId: candidate.id,
            stripeRefundId: candidate.stripeRefundId,
            error: this.errorName(error),
          }),
        );
      }
    }
    if (summary.scanned > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'refund.reconciliation_completed',
          ...summary,
        }),
      );
    }
    await this.dashboardCache.invalidate();
    return summary;
  }

  async processStripeEvent(event: Stripe.Event): Promise<void> {
    if (
      event.type !== 'refund.created' &&
      event.type !== 'refund.updated' &&
      event.type !== 'refund.failed'
    ) {
      return;
    }
    this.logger.log(
      JSON.stringify({ event: 'refund.webhook.received', eventId: event.id, type: event.type }),
    );
    await this.reconcileStripeRefund(event.id, event.type, event.data.object as Stripe.Refund);
  }

  private async reconcileStripeRefund(
    providerEventId: string,
    eventType: string,
    stripeRefund: Stripe.Refund,
  ): Promise<void> {
    const internalId = stripeRefund.metadata?.meroRefundId;
    const internal = await this.prisma.refund.findFirst({
      where: internalId ? { id: internalId } : { stripeRefundId: stripeRefund.id },
      include: refundInclude,
    });
    if (!internal) {
      this.logger.warn(JSON.stringify({ event: 'refund.webhook.unmatched', providerEventId }));
      return;
    }
    let notification: 'success' | 'failed' | null = null;
    await this.prisma.$transaction(
      async (transaction) => {
        const duplicate = await transaction.paymentWebhookEvent.findUnique({
          where: { providerEventId },
        });
        if (duplicate) return;
        await this.lockPayment(transaction, internal.paymentId);
        const current = await transaction.refund.findUnique({ where: { id: internal.id } });
        if (!current) return;
        if (current.stripeRefundId && current.stripeRefundId !== stripeRefund.id) {
          await transaction.paymentWebhookEvent.create({
            data: { provider: 'STRIPE', providerEventId, eventType, refundId: current.id },
          });
          return;
        }
        if (
          stripeRefund.payment_intent !== current.stripePaymentIntentId ||
          stripeRefund.amount !== current.refundAmountCents ||
          stripeRefund.currency.toUpperCase() !== current.currency
        ) {
          throw new BadRequestException('Stripe refund does not match the approved refund.');
        }
        let nextStatus = current.status;
        if (stripeRefund.status === 'succeeded') nextStatus = RefundStatus.SUCCEEDED;
        else if (stripeRefund.status === 'failed' || stripeRefund.status === 'canceled') {
          nextStatus = RefundStatus.FAILED;
        }
        if (current.status === RefundStatus.SUCCEEDED) nextStatus = RefundStatus.SUCCEEDED;
        const changed = nextStatus !== current.status;
        const updated = await transaction.refund.update({
          where: { id: current.id },
          data: {
            stripeRefundId: stripeRefund.id,
            stripeChargeId:
              typeof stripeRefund.charge === 'string'
                ? stripeRefund.charge
                : stripeRefund.charge?.id,
            status: nextStatus,
            processedAt: nextStatus === RefundStatus.SUCCEEDED ? new Date() : current.processedAt,
            failedAt: nextStatus === RefundStatus.FAILED ? new Date() : null,
            failureReason:
              nextStatus === RefundStatus.FAILED
                ? this.safeStripeFailure(stripeRefund.failure_reason)
                : null,
          },
        });
        await transaction.paymentWebhookEvent.create({
          data: { provider: 'STRIPE', providerEventId, eventType, refundId: current.id },
        });
        if (
          changed &&
          (nextStatus === RefundStatus.SUCCEEDED || nextStatus === RefundStatus.FAILED)
        ) {
          await this.audit(
            transaction,
            current.id,
            null,
            nextStatus === RefundStatus.SUCCEEDED ? 'REFUND_SUCCEEDED' : 'REFUND_FAILED',
            current.status,
            nextStatus,
            {
              paymentId: current.paymentId,
              amountCents: current.refundAmountCents,
              stripeRefundId: stripeRefund.id,
              providerEventId,
            },
          );
          notification = nextStatus === RefundStatus.SUCCEEDED ? 'success' : 'failed';
        }
        await this.reconciliation.reconcilePayment(updated.paymentId, transaction);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.dashboardCache.invalidate();
    const refreshed = await this.refundOrThrow(internal.id);
    if (notification === 'success') {
      this.log('refund.succeeded', refreshed);
      await this.notifySafely(() =>
        this.notifications.sendRefundSucceeded(this.emailData(refreshed)),
      );
    } else if (notification === 'failed') {
      this.log('refund.failed', refreshed);
      await this.notifySafely(() => this.notifications.sendRefundFailed(this.emailData(refreshed)));
    }
  }

  private async transition(
    id: string,
    status: RefundStatus,
    actor: AuthenticatedUser,
    options: { internalNote?: string; action: string; rejected?: boolean },
  ): Promise<RefundDetail> {
    const refund = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.refund.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Refund not found.');
      this.policy.assertTransition(current.status, status);
      const updated = await transaction.refund.update({
        where: { id },
        data: {
          status,
          internalNote: options.internalNote ?? current.internalNote,
          rejectedByUserId: options.rejected ? actor.id : undefined,
          rejectedAt: options.rejected ? new Date() : undefined,
        },
        include: refundInclude,
      });
      await this.audit(transaction, id, actor.id, options.action, current.status, status, {
        paymentId: current.paymentId,
        amountCents: current.refundAmountCents,
        reason: current.reason,
      });
      return updated;
    });
    this.log(options.action.toLowerCase(), refund);
    return refund;
  }

  private async failProcessing(id: string, actorUserId: string, failureReason: string) {
    await this.prisma.$transaction(async (transaction) => {
      const refund = await transaction.refund.findUnique({ where: { id } });
      if (!refund || refund.status !== RefundStatus.PROCESSING) return;
      const failed = await transaction.refund.update({
        where: { id },
        data: { status: RefundStatus.FAILED, failedAt: new Date(), failureReason },
      });
      await this.audit(
        transaction,
        id,
        actorUserId,
        'REFUND_FAILED',
        refund.status,
        failed.status,
        { paymentId: refund.paymentId, amountCents: refund.refundAmountCents },
      );
      await this.reconciliation.reconcilePayment(refund.paymentId, transaction);
    });
  }

  private async availableCents(
    transaction: Prisma.TransactionClient,
    paymentId: string,
    excludeRefundId?: string,
  ): Promise<number> {
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: { amountCents: true },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    const reserved = await transaction.refund.aggregate({
      where: {
        paymentId,
        id: excludeRefundId ? { not: excludeRefundId } : undefined,
        status: { in: [RefundStatus.SUCCEEDED, RefundStatus.APPROVED, RefundStatus.PROCESSING] },
      },
      _sum: { refundAmountCents: true },
    });
    return Math.max(0, payment.amountCents - (reserved._sum.refundAmountCents ?? 0));
  }

  private lockPayment(transaction: Prisma.TransactionClient, paymentId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(CAST(${paymentId} AS text), 0))::text AS lock`;
  }

  private refundOrThrow(id: string): Promise<RefundDetail> {
    return this.prisma.refund
      .findUnique({ where: { id }, include: refundInclude })
      .then((refund) => refund ?? Promise.reject(new NotFoundException('Refund not found.')));
  }

  private customerView(refund: RefundDetail) {
    return {
      id: refund.id,
      paymentId: refund.paymentId,
      invoiceId: refund.invoiceId,
      subscriptionId: refund.subscriptionId,
      originalAmountCents: refund.originalAmountCents,
      refundAmountCents: refund.refundAmountCents,
      currency: refund.currency,
      type: refund.type,
      reason: refund.reason,
      customerReason: refund.customerReason,
      status: refund.status,
      requestedAt: refund.requestedAt,
      approvedAt: refund.approvedAt,
      processedAt: refund.processedAt,
      rejectedAt: refund.rejectedAt,
      failedAt: refund.failedAt,
      failureReason: refund.failureReason
        ? 'The refund could not be completed. Please contact support.'
        : null,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      payment: {
        id: refund.payment.id,
        amountCents: refund.payment.amountCents,
        refundedCents: refund.payment.refundedCents,
        currency: refund.payment.currency,
        status: refund.payment.status,
        paidAt: refund.payment.paidAt,
      },
      invoice: refund.invoice,
      subscription: refund.subscription,
      attachments: refund.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        uploadedByRole: attachment.uploadedByRole,
        uploadedBy: attachment.uploadedBy,
        createdAt: attachment.createdAt,
      })),
      customerMessage: refund.customerMessage,
    };
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    refundId: string,
    actorUserId: string | null,
    action: string,
    previousStatus: RefundStatus | null,
    newStatus: RefundStatus,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'Refund',
        entityId: refundId,
        metadata: { ...metadata, previousStatus, newStatus },
      },
    });
  }

  private emailData(refund: RefundDetail) {
    return {
      refundId: refund.id,
      customerName: `${refund.customer.firstName} ${refund.customer.lastName}`,
      customerEmail: refund.customer.email,
      invoiceNumber: refund.invoice?.invoiceNumber ?? 'Not linked',
      originalAmountCents: refund.originalAmountCents,
      refundAmountCents: refund.refundAmountCents,
      currency: refund.currency,
      reason: refund.reason,
      processedAt: refund.processedAt ?? new Date(),
      customerMessage: refund.customerMessage,
    };
  }

  private async notifySafely(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({ event: 'refund.notification_failed', error: this.errorName(error) }),
      );
    }
  }

  private safeStripeFailure(reason: string | null | undefined): string {
    const allowed = new Set([
      'lost_or_stolen_card',
      'expired_or_canceled_card',
      'charge_for_pending_refund_disputed',
      'insufficient_funds',
      'declined',
      'merchant_request',
      'unknown',
    ]);
    return reason && allowed.has(reason) ? reason.replaceAll('_', ' ') : 'Stripe refund failed';
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError';
  }

  private log(
    event: string,
    refund: {
      id: string;
      paymentId: string;
      refundAmountCents: number;
      status: RefundStatus;
      stripeRefundId?: string | null;
    },
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        refundId: refund.id,
        paymentId: refund.paymentId,
        amountCents: refund.refundAmountCents,
        status: refund.status,
        stripeRefundId: refund.stripeRefundId,
      }),
    );
  }

  private pagination(query: RefundQueryDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  private uuidSearch(value: string): string | undefined {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value
      : undefined;
  }
}
