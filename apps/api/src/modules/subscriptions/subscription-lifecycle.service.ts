import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceStatus,
  PaymentProvider,
  PaymentStatus,
  PlanChangeStatus,
  Prisma,
  ServiceProvisioningStatus,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { NotificationService } from '../notifications/notification.service';
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
}

@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);
  private readonly gracePeriodDays: number;
  private readonly terminationDays: number;
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
    private readonly eligibility: PaymentEligibilityService,
    private readonly provisioning: ProvisioningService,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {
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
        const payment = await transaction.payment.findFirst({
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
        if (payment?.status === PaymentStatus.PENDING) {
          await transaction.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.FAILED },
          });
        }
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

  async markDueInvoicesOverdue(now = new Date()): Promise<number> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.ISSUED,
        dueDate: { lt: now },
        subscriptionId: { not: null },
      },
      select: { id: true },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: this.batchSize,
    });
    for (const invoice of invoices) {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          const current = await transaction.invoice.findUnique({
            where: { id: invoice.id },
            include: lifecycleInvoiceInclude,
          });
          if (!current || current.status !== InvoiceStatus.ISSUED) return null;
          return this.markPastDue(transaction, current, now);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (result?.statusChanged) {
        await this.notify(result.invoice, 'OVERDUE_REMINDER', 'initial');
      }
    }
    if (invoices.length) await this.dashboardCache.invalidate();
    return invoices.length;
  }

  async handleConfirmedPayment(invoiceId: string): Promise<void> {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const invoice = await transaction.invoice.findUnique({
          where: { id: invoiceId },
          include: lifecycleInvoiceInclude,
        });
        if (!invoice || invoice.status !== InvoiceStatus.PAID || !invoice.subscription) return null;
        const subscription = invoice.subscription;
        if (
          subscription.status !== SubscriptionStatus.PAST_DUE &&
          subscription.status !== SubscriptionStatus.SUSPENDED
        ) {
          return null;
        }
        if (
          subscription.status === SubscriptionStatus.SUSPENDED &&
          subscription.suspensionReason !== SuspensionReason.NON_PAYMENT
        ) {
          return null;
        }
        if (await this.eligibility.hasBlockingOutstandingBalance(subscription.id, transaction)) {
          return null;
        }
        const restoredAt = new Date();
        const wasSuspended = subscription.status === SubscriptionStatus.SUSPENDED;
        assertSubscriptionTransition(subscription.status, SubscriptionStatus.ACTIVE);
        const updated = await transaction.subscription.updateMany({
          where: {
            id: subscription.id,
            status: subscription.status,
            ...(wasSuspended ? { suspensionReason: SuspensionReason.NON_PAYMENT } : {}),
          },
          data: {
            status: SubscriptionStatus.ACTIVE,
            pastDueAt: null,
            gracePeriodEndsAt: null,
            suspensionReason: null,
            reactivatedAt: restoredAt,
            eligibleForTerminationAt: null,
            terminationReviewQueuedAt: null,
            overdueReminderStage: 0,
            suspensionWarningSentAt: null,
            provisioningStatus: wasSuspended ? ServiceProvisioningStatus.PENDING : undefined,
            provisioningFailure: null,
          },
        });
        if (updated.count !== 1) return null;
        await transaction.auditLog.createMany({
          data: [
            {
              action: wasSuspended
                ? 'PAYMENT_RECEIVED_AFTER_SUSPENSION'
                : 'PAYMENT_RECEIVED_WHILE_PAST_DUE',
              entityType: 'Subscription',
              entityId: subscription.id,
              metadata: this.auditMetadata(invoice, {
                previousStatus: subscription.status,
                newStatus: SubscriptionStatus.ACTIVE,
              }),
            },
            ...(wasSuspended
              ? [
                  {
                    action: 'SERVICE_RESTORATION_REQUESTED',
                    entityType: 'Subscription',
                    entityId: subscription.id,
                    metadata: this.auditMetadata(invoice, {
                      previousStatus: subscription.status,
                      newStatus: SubscriptionStatus.ACTIVE,
                    }),
                  },
                ]
              : []),
          ],
        });
        return { invoice, wasSuspended, restoredAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result) return;
    if (result.wasSuspended && result.invoice.subscription) {
      await this.provisioning.restoreService(result.invoice.subscription.id, result.restoredAt);
      await this.notify(
        result.invoice,
        'SERVICE_RESTORATION_REQUESTED',
        result.restoredAt.toISOString(),
      );
    } else {
      await this.notify(result.invoice, 'PAYMENT_RECEIVED', invoiceId);
    }
    await this.dashboardCache.invalidate();
  }

  async suspendExpiredGracePeriods(now = new Date()): Promise<number> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        gracePeriodEndsAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ gracePeriodEndsAt: 'asc' }, { id: 'asc' }],
      take: this.batchSize,
    });
    let transitioned = 0;
    for (const subscription of subscriptions) {
      if (await this.suspendForNonPayment(subscription.id, now)) transitioned += 1;
    }
    return transitioned;
  }

  async processNotifications(now = new Date()): Promise<number> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.PAST_DUE, gracePeriodEndsAt: { gt: now } },
      include: {
        customer: true,
        invoices: {
          where: { status: InvoiceStatus.OVERDUE },
          orderBy: { dueDate: 'asc' },
          take: 1,
        },
      },
      orderBy: [{ gracePeriodEndsAt: 'asc' }, { id: 'asc' }],
      take: this.batchSize,
    });
    let sent = 0;
    for (const subscription of subscriptions) {
      const invoice = subscription.invoices[0];
      if (!invoice || !subscription.pastDueAt || !subscription.gracePeriodEndsAt) continue;
      const remaining = subscription.gracePeriodEndsAt.getTime() - now.getTime();
      if (remaining <= 24 * 60 * 60 * 1000 && !subscription.suspensionWarningSentAt) {
        const claimed = await this.prisma.subscription.updateMany({
          where: { id: subscription.id, suspensionWarningSentAt: null },
          data: { suspensionWarningSentAt: now },
        });
        if (claimed.count) {
          await this.notifyRecord(
            subscription,
            subscription.customer,
            invoice,
            'SUSPENSION_WARNING',
            'warning',
          );
          await this.prisma.auditLog.create({
            data: {
              action: 'SUSPENSION_WARNING_SENT',
              entityType: 'Subscription',
              entityId: subscription.id,
              metadata: {
                invoiceId: invoice.id,
                gracePeriodEndsAt: subscription.gracePeriodEndsAt,
              },
            },
          });
          sent += 1;
        }
        continue;
      }
      const elapsedDays = Math.floor(
        (now.getTime() - subscription.pastDueAt.getTime()) / 86_400_000,
      );
      const stage = elapsedDays >= 6 ? 3 : elapsedDays >= 4 ? 2 : elapsedDays >= 1 ? 1 : 0;
      if (stage <= subscription.overdueReminderStage) continue;
      const claimed = await this.prisma.subscription.updateMany({
        where: { id: subscription.id, overdueReminderStage: { lt: stage } },
        data: { overdueReminderStage: stage },
      });
      if (claimed.count) {
        await this.notifyRecord(
          subscription,
          subscription.customer,
          invoice,
          'OVERDUE_REMINDER',
          `day-${elapsedDays}`,
        );
        await this.prisma.auditLog.create({
          data: {
            action: 'OVERDUE_REMINDER_SENT',
            entityType: 'Subscription',
            entityId: subscription.id,
            metadata: { invoiceId: invoice.id, reminderStage: stage, overdueDays: elapsedDays },
          },
        });
        sent += 1;
      }
    }
    return sent;
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

  async extendGracePeriod(id: string, days: number, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (subscription.status !== SubscriptionStatus.PAST_DUE || !subscription.gracePeriodEndsAt) {
      throw new BadRequestException(
        'Only a past-due subscription can have its grace period extended.',
      );
    }
    const gracePeriodEndsAt = addUtcDays(subscription.gracePeriodEndsAt, days);
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { gracePeriodEndsAt, suspensionWarningSentAt: null },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'OVERDUE_GRACE_PERIOD_EXTENDED',
        entityType: 'Subscription',
        entityId: id,
        metadata: { days, previousEndsAt: subscription.gracePeriodEndsAt, gracePeriodEndsAt },
      },
    });
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

  private async suspendForNonPayment(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const subscription = await transaction.subscription.findUnique({
          where: { id },
          include: {
            customer: true,
            plan: true,
            invoices: {
              where: {
                status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
                dueDate: { lte: now },
              },
              orderBy: { dueDate: 'asc' },
              take: 1,
            },
          },
        });
        if (
          !subscription ||
          subscription.status !== SubscriptionStatus.PAST_DUE ||
          !subscription.gracePeriodEndsAt ||
          subscription.gracePeriodEndsAt > now ||
          !subscription.invoices.length
        ) {
          return null;
        }
        const changed = await transaction.subscription.updateMany({
          where: { id, status: SubscriptionStatus.PAST_DUE, gracePeriodEndsAt: { lte: now } },
          data: {
            status: SubscriptionStatus.SUSPENDED,
            suspendedAt: now,
            suspensionReason: SuspensionReason.NON_PAYMENT,
            provisioningStatus: ServiceProvisioningStatus.PENDING,
            provisioningFailure: null,
          },
        });
        if (!changed.count) return null;
        assertSubscriptionTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED);
        await transaction.planChangeRequest.updateMany({
          where: {
            sourceSubscriptionId: id,
            status: {
              in: [
                PlanChangeStatus.PENDING,
                PlanChangeStatus.CHECKOUT_CREATED,
                PlanChangeStatus.PROCESSING,
                PlanChangeStatus.SCHEDULED,
              ],
            },
          },
          data: {
            status: PlanChangeStatus.CANCELLED,
            cancelledAt: now,
            cancellationReason: 'SUBSCRIPTION_SUSPENDED_NON_PAYMENT',
          },
        });
        const invoice = subscription.invoices[0];
        await transaction.auditLog.create({
          data: {
            action: 'SERVICE_SUSPENDED_NON_PAYMENT',
            entityType: 'Subscription',
            entityId: id,
            metadata: {
              customerId: subscription.customerId,
              invoiceId: invoice.id,
              amountCents: invoice.totalCents,
              previousStatus: SubscriptionStatus.PAST_DUE,
              newStatus: SubscriptionStatus.SUSPENDED,
              reason: SuspensionReason.NON_PAYMENT,
            },
          },
        });
        return { subscription, invoice };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result) return false;
    await this.provisioning.suspendService(id, now);
    await this.notifyRecord(
      result.subscription,
      result.subscription.customer,
      result.invoice,
      'SERVICE_SUSPENDED',
      now.toISOString(),
    );
    await this.dashboardCache.invalidate();
    return true;
  }

  private async markPastDue(
    transaction: Prisma.TransactionClient,
    invoice: LifecycleInvoice,
    overdueAt: Date,
  ): Promise<{ invoice: LifecycleInvoice; statusChanged: boolean }> {
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
      return { invoice, statusChanged: false };
    }
    const effectiveOverdueAt = invoice.overdueAt ?? overdueAt;
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.OVERDUE, overdueAt: effectiveOverdueAt },
    });
    if (!invoice.subscription || invoice.subscription.status !== SubscriptionStatus.ACTIVE) {
      return {
        invoice: { ...invoice, status: InvoiceStatus.OVERDUE, overdueAt: effectiveOverdueAt },
        statusChanged: false,
      };
    }
    const gracePeriodEndsAt = this.gracePeriodEndsAt(effectiveOverdueAt);
    const eligibleForTerminationAt = this.eligibleForTerminationAt(effectiveOverdueAt);
    assertSubscriptionTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE);
    const changed = await transaction.subscription.updateMany({
      where: { id: invoice.subscription.id, status: SubscriptionStatus.ACTIVE },
      data: {
        status: SubscriptionStatus.PAST_DUE,
        pastDueAt: effectiveOverdueAt,
        gracePeriodEndsAt,
        eligibleForTerminationAt,
        overdueReminderStage: 0,
        suspensionWarningSentAt: null,
      },
    });
    if (changed.count) {
      await transaction.planChangeRequest.updateMany({
        where: {
          sourceSubscriptionId: invoice.subscription.id,
          status: {
            in: [
              PlanChangeStatus.PENDING,
              PlanChangeStatus.CHECKOUT_CREATED,
              PlanChangeStatus.PROCESSING,
              PlanChangeStatus.SCHEDULED,
            ],
          },
        },
        data: {
          status: PlanChangeStatus.CANCELLED,
          cancelledAt: effectiveOverdueAt,
          cancellationReason: 'SUBSCRIPTION_PAST_DUE',
        },
      });
      await transaction.auditLog.createMany({
        data: [
          {
            action: 'SUBSCRIPTION_MARKED_PAST_DUE',
            entityType: 'Subscription',
            entityId: invoice.subscription.id,
            metadata: this.auditMetadata(invoice, {
              previousStatus: SubscriptionStatus.ACTIVE,
              newStatus: SubscriptionStatus.PAST_DUE,
            }),
          },
          {
            action: 'GRACE_PERIOD_STARTED',
            entityType: 'Subscription',
            entityId: invoice.subscription.id,
            metadata: this.auditMetadata(invoice, {
              overdueAt: effectiveOverdueAt,
              gracePeriodEndsAt,
            }),
          },
        ],
      });
    }
    return {
      invoice: {
        ...invoice,
        status: InvoiceStatus.OVERDUE,
        overdueAt: effectiveOverdueAt,
        subscription: invoice.subscription
          ? {
              ...invoice.subscription,
              status: changed.count ? SubscriptionStatus.PAST_DUE : invoice.subscription.status,
              pastDueAt: effectiveOverdueAt,
              gracePeriodEndsAt,
              eligibleForTerminationAt,
            }
          : null,
      },
      statusChanged: changed.count === 1,
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
  ): Promise<void> {
    if (!invoice.subscription) return;
    await this.notifyRecord(invoice.subscription, invoice.customer, invoice, event, suffix);
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
    invoice: Pick<LifecycleInvoice, 'invoiceNumber' | 'totalCents' | 'currency' | 'dueDate'>,
    event: Parameters<NotificationService['sendOverdueLifecycleNotification']>[0]['event'],
    suffix: string,
  ): Promise<void> {
    if (!subscription) return;
    try {
      await this.notifications.sendOverdueLifecycleNotification({
        event,
        subscriptionId: subscription.id,
        idempotencySuffix: suffix,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        invoiceNumber: invoice.invoiceNumber,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        dueDate: invoice.dueDate,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        suspendedAt: subscription.suspendedAt,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'overdue_notification_enqueue_failed',
          subscriptionId: subscription.id,
          notification: event,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
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
