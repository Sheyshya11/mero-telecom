import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingMode,
  InvoiceCollectionStatus,
  InvoiceStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ServiceProvisioningStatus,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';
import type Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { NotificationService } from '../notifications/notification.service';
import { CollectionService } from './collection.service';
import { PaymentEligibilityService } from './payment-eligibility.service';
import { ProvisioningService } from './provisioning.service';
import { assertSubscriptionTransition } from './subscription-lifecycle.policy';

const lifecycleInvoiceInclude = {
  customer: true,
  subscription: { include: { plan: true } },
} satisfies Prisma.InvoiceInclude;

type LifecycleInvoice = Prisma.InvoiceGetPayload<{ include: typeof lifecycleInvoiceInclude }>;

interface PaymentFailureInput {
  providerEventId: string;
  eventType: string;
  invoiceId: string;
  providerSessionId?: string;
  providerPaymentId?: string;
  expectedCustomerId?: string;
  expectedAmountCents?: number;
  expectedCurrency?: string;
  failedAt?: Date;
  attemptCount?: number;
  nextPaymentAttempt?: Date;
  collectionStatus?: InvoiceCollectionStatus;
  paymentErrorCode?: string;
}

interface PaymentActionRequiredInput extends PaymentFailureInput {
  hostedInvoiceUrl?: string;
}

@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);
  private readonly gracePeriodDays: number;
  private readonly terminationDays: number;
  private readonly batchSize: number;
  private readonly stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
    private readonly eligibility: PaymentEligibilityService,
    private readonly provisioning: ProvisioningService,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
    stripeClient?: StripeClientService,
    @Optional() private readonly collections?: CollectionService,
  ) {
    this.stripe = stripeClient?.client;
    const lifecycle = config.getOrThrow('overdueLifecycle');
    this.gracePeriodDays = lifecycle.gracePeriodDays;
    this.terminationDays = lifecycle.terminationDays;
    this.batchSize = lifecycle.batchSize;
  }

  gracePeriodEndsAt(overdueAt: Date): Date {
    return addUtcDays(overdueAt, this.gracePeriodDays);
  }

  eligibleForTerminationAt(overdueAt: Date): Date {
    return addUtcDays(overdueAt, this.terminationDays);
  }

  async handlePaymentFailure(input: PaymentFailureInput): Promise<void> {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        if (
          await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId: input.providerEventId },
          })
        ) {
          return null;
        }
        const invoice = await transaction.invoice.findUnique({
          where: { id: input.invoiceId },
          include: lifecycleInvoiceInclude,
        });
        if (!invoice) throw new NotFoundException('Invoice referenced by Stripe was not found.');
        this.assertStripeInvoiceMatch(invoice, input);
        if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: input.providerEventId,
              eventType: input.eventType,
            },
          });
          return null;
        }
        let payment = await transaction.payment.findFirst({
          where: {
            invoiceId: invoice.id,
            provider: PaymentProvider.STRIPE,
            ...(input.providerSessionId
              ? { providerSessionId: input.providerSessionId }
              : input.providerPaymentId
                ? { providerPaymentId: input.providerPaymentId }
                : {}),
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!payment && invoice.stripeInvoiceId) {
          payment = await transaction.payment.findFirst({
            where: {
              invoiceId: invoice.id,
              provider: PaymentProvider.STRIPE,
              providerPaymentId: `stripe-invoice:${invoice.stripeInvoiceId}`,
              status: PaymentStatus.PENDING,
            },
          });
        }
        if (
          (input.providerSessionId ||
            input.providerPaymentId ||
            payment?.providerPaymentId === `stripe-invoice:${invoice.stripeInvoiceId}`) &&
          (payment?.status === PaymentStatus.PENDING ||
            payment?.status === PaymentStatus.PROCESSING)
        ) {
          await transaction.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.FAILED,
              ...(input.providerPaymentId &&
              payment.providerPaymentId?.startsWith('stripe-invoice:')
                ? { providerPaymentId: input.providerPaymentId }
                : {}),
            },
          });
        }
        await transaction.invoice.update({
          where: { id: invoice.id },
          data: {
            collectionStatus:
              input.collectionStatus ?? InvoiceCollectionStatus.PAYMENT_METHOD_REQUIRED,
            stripeAttemptCount: input.attemptCount ?? invoice.stripeAttemptCount,
            stripeNextPaymentAttempt: input.nextPaymentAttempt ?? null,
            stripeLastPaymentErrorCode: input.paymentErrorCode ?? null,
            paymentActionRequiredAt: null,
          },
        });
        const transition = await this.markPastDue(
          transaction,
          invoice,
          input.failedAt ?? new Date(),
        );
        await transaction.paymentWebhookEvent.create({
          data: {
            provider: PaymentProvider.STRIPE,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            paymentId: payment?.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'PAYMENT_FAILED',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: this.auditMetadata(invoice, {
              providerEventId: input.providerEventId,
              paymentId: payment?.id,
            }),
          },
        });
        return { invoice: transition.invoice, statusChanged: transition.statusChanged };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result) return;
    await this.notify(result.invoice, 'PAYMENT_FAILED', input.providerEventId);
    await this.dashboardCache.invalidate();
  }

  async handlePaymentActionRequired(input: PaymentActionRequiredInput): Promise<void> {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        if (
          await transaction.paymentWebhookEvent.findUnique({
            where: { providerEventId: input.providerEventId },
          })
        ) {
          return null;
        }
        const invoice = await transaction.invoice.findUnique({
          where: { id: input.invoiceId },
          include: lifecycleInvoiceInclude,
        });
        if (!invoice) throw new NotFoundException('Invoice referenced by Stripe was not found.');
        this.assertStripeInvoiceMatch(invoice, input);
        if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: input.providerEventId,
              eventType: input.eventType,
            },
          });
          return null;
        }
        const requiredAt = input.failedAt ?? new Date();
        await transaction.invoice.update({
          where: { id: invoice.id },
          data: {
            collectionStatus: InvoiceCollectionStatus.ACTION_REQUIRED,
            stripeAttemptCount: input.attemptCount ?? invoice.stripeAttemptCount,
            stripeNextPaymentAttempt: input.nextPaymentAttempt ?? null,
            stripeLastPaymentErrorCode: input.paymentErrorCode ?? null,
            paymentActionRequiredAt: requiredAt,
            stripeHostedUrl: input.hostedInvoiceUrl ?? invoice.stripeHostedUrl,
          },
        });
        const transition = await this.markPastDue(transaction, invoice, requiredAt);
        await transaction.paymentWebhookEvent.create({
          data: {
            provider: PaymentProvider.STRIPE,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'PAYMENT_AUTHENTICATION_REQUIRED',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: this.auditMetadata(invoice, {
              providerEventId: input.providerEventId,
              attemptCount: input.attemptCount ?? null,
            }),
          },
        });
        return { invoice: transition.invoice };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result) return;
    await this.notify(
      result.invoice,
      'PAYMENT_AUTHENTICATION_REQUIRED',
      input.providerEventId,
      input.hostedInvoiceUrl,
    );
    await this.dashboardCache.invalidate();
  }

  async markDueInvoicesOverdue(now = new Date()): Promise<number> {
    return this.collections!.markOverdue(now);
  }

  async handleConfirmedPayment(invoiceId: string): Promise<void> {
    await this.collections!.confirmedPayment(invoiceId);
    await this.provisioning.reconcilePending(this.batchSize);
    await this.collections!.deliver();
  }

  async suspendExpiredGracePeriods(now = new Date()): Promise<number> {
    return this.collections!.suspend(now);
  }

  async processNotifications(now = new Date()): Promise<number> {
    return this.collections!.warnings(now);
  }

  async queueTerminationReviews(now = new Date()): Promise<number> {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.SUSPENDED,
        suspensionReason: SuspensionReason.NON_PAYMENT,
        eligibleForTerminationAt: { lte: now },
        terminationReviewQueuedAt: null,
      },
      select: { id: true, customerId: true, eligibleForTerminationAt: true },
      take: this.batchSize,
    });
    let queued = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.subscription.updateMany({
        where: { id: candidate.id, terminationReviewQueuedAt: null },
        data: { terminationReviewQueuedAt: now },
      });
      if (!claimed.count) continue;
      await this.prisma.auditLog.create({
        data: {
          action: 'NON_PAYMENT_TERMINATION_ELIGIBLE',
          entityType: 'Subscription',
          entityId: candidate.id,
          metadata: {
            customerId: candidate.customerId,
            eligibleForTerminationAt: candidate.eligibleForTerminationAt,
          },
        },
      });
      queued += 1;
    }
    return queued;
  }

  async extendGracePeriod(id: string, days: number, actor: AuthenticatedUser, reason: string) {
    if (!Number.isInteger(days) || days < 1 || days > 30 || reason.trim().length < 3)
      throw new BadRequestException(
        'A grace extension requires 1-30 days and a meaningful reason.',
      );
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        const subscription = await transaction.subscription.findUnique({ where: { id } });
        if (!subscription) throw new NotFoundException('Subscription not found.');
        if (
          ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
            (status) => status === subscription.status,
          ) ||
          !subscription.gracePeriodEndsAt
        ) {
          throw new BadRequestException(
            'Only an active service with an overdue grace period can have its grace extended.',
          );
        }
        const gracePeriodEndsAt = addUtcDays(subscription.gracePeriodEndsAt, days);
        const terminationOffsetDays = Math.max(0, this.terminationDays - this.gracePeriodDays);
        const eligibleForTerminationAt = subscription.eligibleForTerminationAt
          ? addUtcDays(subscription.eligibleForTerminationAt, days)
          : addUtcDays(gracePeriodEndsAt, terminationOffsetDays);
        const changed = await transaction.subscription.updateMany({
          where: {
            id,
            status: subscription.status,
            gracePeriodEndsAt: subscription.gracePeriodEndsAt,
            eligibleForTerminationAt: subscription.eligibleForTerminationAt,
          },
          data: {
            gracePeriodEndsAt,
            eligibleForTerminationAt,
            graceExtendedUntil: gracePeriodEndsAt,
            graceExtensionReason: reason,
            graceExtendedBy: actor.id,
            graceExtendedAt: new Date(),
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('Subscription changed while its grace period was extended.');
        }
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: 'GRACE_PERIOD_EXTENDED',
            entityType: 'Subscription',
            entityId: id,
            metadata: {
              days,
              reason,
              previousEndsAt: subscription.gracePeriodEndsAt,
              gracePeriodEndsAt,
              previousEligibleForTerminationAt: subscription.eligibleForTerminationAt,
              eligibleForTerminationAt,
            },
          },
        });
        const invoice = await transaction.invoice.findFirst({
          where: { subscriptionId: id, status: InvoiceStatus.OVERDUE },
          orderBy: { dueDate: 'asc' },
        });
        if (invoice)
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: 'GRACE_PERIOD_EXTENSION_NOTIFICATION',
              entityType: 'Invoice',
              entityId: invoice.id,
              notificationEvent: 'GRACE_PERIOD_EXTENDED',
              metadata: { subscriptionId: id },
            },
          });
        return transaction.subscription.findUniqueOrThrow({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.collections!.deliver();
    await this.dashboardCache.invalidate();
    return updated;
  }

  async suspendAdministratively(id: string, actor: AuthenticatedUser, reason: SuspensionReason) {
    if (reason === SuspensionReason.NON_PAYMENT) {
      throw new BadRequestException(
        'Non-payment suspension is controlled by the overdue scheduler.',
      );
    }
    const now = new Date();
    assertSubscriptionTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED);
    const updated = await this.prisma.subscription.updateMany({
      where: { id, status: SubscriptionStatus.ACTIVE },
      data: {
        status: SubscriptionStatus.SUSPENDED,
        suspendedAt: now,
        suspensionReason: reason,
        provisioningStatus: ServiceProvisioningStatus.PENDING,
        provisioningFailure: null,
      },
    });
    if (!updated.count)
      throw new ConflictException('Only an active subscription can be suspended.');
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'SERVICE_SUSPENDED_ADMINISTRATIVELY',
        entityType: 'Subscription',
        entityId: id,
        metadata: {
          reason,
          previousStatus: SubscriptionStatus.ACTIVE,
          newStatus: SubscriptionStatus.SUSPENDED,
        },
      },
    });
    await this.provisioning.suspendService(id, now);
    await this.dashboardCache.invalidate();
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  async reactivateAdministratively(id: string, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (subscription.status !== SubscriptionStatus.SUSPENDED) {
      throw new ConflictException('Only a suspended subscription can be reactivated.');
    }
    if (await this.eligibility.hasBlockingOutstandingBalance(id)) {
      throw new ConflictException('Outstanding overdue invoices must be paid before reactivation.');
    }
    const now = new Date();
    assertSubscriptionTransition(subscription.status, SubscriptionStatus.ACTIVE);
    await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        suspensionReason: null,
        reactivatedAt: now,
        pastDueAt: null,
        gracePeriodEndsAt: null,
        eligibleForTerminationAt: null,
        terminationReviewQueuedAt: null,
        provisioningStatus: ServiceProvisioningStatus.PENDING,
        provisioningFailure: null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'SERVICE_RESTORATION_REQUESTED',
        entityType: 'Subscription',
        entityId: id,
        metadata: {
          previousStatus: SubscriptionStatus.SUSPENDED,
          newStatus: SubscriptionStatus.ACTIVE,
        },
      },
    });
    await this.provisioning.restoreService(id, now);
    await this.dashboardCache.invalidate();
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  async terminateForNonPayment(id: string, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (
      subscription.status !== SubscriptionStatus.SUSPENDED ||
      subscription.suspensionReason !== SuspensionReason.NON_PAYMENT ||
      !subscription.eligibleForTerminationAt ||
      subscription.eligibleForTerminationAt > new Date()
    ) {
      throw new ConflictException('This subscription is not eligible for non-payment termination.');
    }
    if (
      subscription.billingMode === BillingMode.STRIPE_RECURRING &&
      subscription.stripeSubscriptionId
    ) {
      await this.stripe!.subscriptions.cancel(
        subscription.stripeSubscriptionId,
        {},
        { idempotencyKey: `non-payment-termination-${subscription.id}` },
      );
    }
    const now = new Date();
    assertSubscriptionTransition(subscription.status, SubscriptionStatus.TERMINATED);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.TERMINATED,
        endDate: now,
        endReason: 'NON_PAYMENT',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'SERVICE_TERMINATED_NON_PAYMENT',
        entityType: 'Subscription',
        entityId: id,
        metadata: {
          previousStatus: SubscriptionStatus.SUSPENDED,
          newStatus: SubscriptionStatus.TERMINATED,
        },
      },
    });
    await this.dashboardCache.invalidate();
    return updated;
  }

  private async markPastDue(
    transaction: Prisma.TransactionClient,
    invoice: LifecycleInvoice,
    overdueAt: Date,
  ): Promise<{ invoice: LifecycleInvoice; statusChanged: boolean }> {
    if (
      invoice.status === InvoiceStatus.PAID ||
      invoice.status === InvoiceStatus.CANCELLED ||
      invoice.dueDate >= overdueAt
    )
      return { invoice, statusChanged: false };
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.OVERDUE, overdueAt: invoice.dueDate },
    });
    if (invoice.status !== InvoiceStatus.OVERDUE)
      await transaction.auditLog.upsert({
        where: { deduplicationKey: `${invoice.id}-INVOICE_BECAME_OVERDUE` },
        create: {
          action: 'INVOICE_BECAME_OVERDUE',
          entityType: 'Invoice',
          entityId: invoice.id,
          deduplicationKey: `${invoice.id}-INVOICE_BECAME_OVERDUE`,
          metadata: { subscriptionId: invoice.subscriptionId },
        },
        update: {},
      });
    return {
      invoice: { ...invoice, status: InvoiceStatus.OVERDUE, overdueAt: invoice.dueDate },
      statusChanged: false,
    };
  }

  private assertStripeInvoiceMatch(invoice: LifecycleInvoice, input: PaymentFailureInput): void {
    if (
      (input.expectedCustomerId && input.expectedCustomerId !== invoice.customerId) ||
      (input.expectedAmountCents !== undefined &&
        input.expectedAmountCents !== invoice.totalCents) ||
      (input.expectedCurrency && input.expectedCurrency.toUpperCase() !== invoice.currency)
    ) {
      throw new BadRequestException('Stripe payment failure does not match the invoice.');
    }
  }

  private async notify(
    invoice: LifecycleInvoice,
    event: Parameters<NotificationService['sendOverdueLifecycleNotification']>[0]['event'],
    suffix: string,
    actionUrl?: string | null,
  ): Promise<boolean> {
    if (!invoice.subscription) return false;
    return this.notifyRecord(
      invoice.subscription,
      invoice.customer,
      invoice,
      event,
      suffix,
      actionUrl,
    );
  }

  private async notifyRecord(
    subscription:
      | NonNullable<LifecycleInvoice['subscription']>
      | {
          id: string;
          gracePeriodEndsAt: Date | null;
          suspendedAt: Date | null;
        },
    customer: LifecycleInvoice['customer'],
    invoice: Pick<LifecycleInvoice, 'id' | 'invoiceNumber' | 'totalCents' | 'currency' | 'dueDate'>,
    event: Parameters<NotificationService['sendOverdueLifecycleNotification']>[0]['event'],
    suffix: string,
    actionUrl?: string | null,
  ): Promise<boolean> {
    if (!subscription) return false;
    try {
      await this.notifications.sendOverdueLifecycleNotification({
        event,
        subscriptionId: subscription.id,
        idempotencySuffix: suffix,
        userId: customer.userId,
        invoiceId: invoice.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        invoiceNumber: invoice.invoiceNumber,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        suspendedAt: subscription.suspendedAt,
        actionUrl,
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'overdue_notification_enqueue_failed',
          subscriptionId: subscription.id,
          notification: event,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return false;
    }
  }

  private auditMetadata(invoice: LifecycleInvoice, extra: Record<string, unknown>) {
    return {
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      ...extra,
    };
  }
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
