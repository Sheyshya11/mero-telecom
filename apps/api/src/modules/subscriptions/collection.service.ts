import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CollectionStage,
  InvoiceStatus,
  InvoiceType,
  PaymentStatus,
  Prisma,
  ServiceProvisioningAction,
  ServiceProvisioningStatus,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { AccountLedgerService } from '../account-ledger/account-ledger.service';
import { NotificationService } from '../notifications/notification.service';
import type { OverdueEmailEvent } from '../notifications/templates/overdue-email.template';
import { CollectionPolicyService, type CollectionSettings } from './collection-policy.service';

export const collectionInvoiceInclude = {
  customer: true,
  payments: true,
  subscription: true,
} satisfies Prisma.InvoiceInclude;
type CollectionInvoice = Prisma.InvoiceGetPayload<{ include: typeof collectionInvoiceInclude }>;
const unpaid: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE];
const reminderEvents = [
  'FIRST_REMINDER',
  'SECOND_REMINDER',
  'FINAL_WARNING',
  'MANUAL_REMINDER',
] as const;

// Invoice totals already include allocated credits. Unallocated account credits are never subtracted twice.
export function payableCents(invoice: {
  totalCents: number;
  status: InvoiceStatus;
  payments: Array<{ amountCents: number; status: PaymentStatus }>;
}): number {
  if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) return 0;
  return Math.max(
    0,
    invoice.totalCents -
      invoice.payments
        .filter((p) =>
          [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED].some(
            (status) => status === p.status,
          ),
        )
        .reduce((sum, p) => sum + p.amountCents, 0),
  );
}
export function suspensionDate(
  invoice: Pick<CollectionInvoice, 'dueDate' | 'finalWarningSentAt' | 'suspensionScheduledAt'> & {
    firstReminderSentAt?: Date | null;
    secondReminderSentAt?: Date | null;
  },
  extension: Date | null,
  policy: CollectionSettings,
  dayMs: number,
  now = new Date(),
): Date {
  const due = invoice.dueDate.getTime();
  const first =
    invoice.firstReminderSentAt?.getTime() ??
    Math.max(due + policy.firstReminderDays * dayMs, now.getTime());
  const second =
    invoice.secondReminderSentAt?.getTime() ??
    Math.max(
      due + policy.secondReminderDays * dayMs,
      first + (policy.secondReminderDays - policy.firstReminderDays) * dayMs,
      now.getTime(),
    );
  const final =
    invoice.finalWarningSentAt?.getTime() ??
    Math.max(
      due + policy.finalWarningDays * dayMs,
      second + (policy.finalWarningDays - policy.secondReminderDays) * dayMs,
      now.getTime(),
    );
  return new Date(
    Math.max(
      due + policy.suspensionDays * dayMs,
      extension?.getTime() ?? 0,
      invoice.suspensionScheduledAt?.getTime() ?? 0,
      final + (policy.suspensionDays - policy.finalWarningDays) * dayMs,
    ),
  );
}
export function nextWarning(
  invoice: Pick<
    CollectionInvoice,
    'dueDate' | 'firstReminderSentAt' | 'secondReminderSentAt' | 'finalWarningSentAt'
  >,
  now: Date,
  policy: CollectionSettings,
  dayMs: number,
): (typeof reminderEvents)[number] | null {
  const due = invoice.dueDate.getTime();
  if (!invoice.firstReminderSentAt)
    return now.getTime() >= due + policy.firstReminderDays * dayMs ? 'FIRST_REMINDER' : null;
  if (!invoice.secondReminderSentAt)
    return now.getTime() >=
      Math.max(
        due + policy.secondReminderDays * dayMs,
        invoice.firstReminderSentAt.getTime() +
          (policy.secondReminderDays - policy.firstReminderDays) * dayMs,
      )
      ? 'SECOND_REMINDER'
      : null;
  if (!invoice.finalWarningSentAt)
    return now.getTime() >=
      Math.max(
        due + policy.finalWarningDays * dayMs,
        invoice.secondReminderSentAt.getTime() +
          (policy.finalWarningDays - policy.secondReminderDays) * dayMs,
      )
      ? 'FINAL_WARNING'
      : null;
  return null;
}

@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: CollectionPolicyService,
    private readonly notifications: NotificationService,
    private readonly cache: AdminDashboardCacheService,
    private readonly ledger: AccountLedgerService,
  ) {}

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 2
        )
          throw error;
      }
    }
  }
  private async lock(tx: Prisma.TransactionClient, subscriptionId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = CAST(${subscriptionId} AS uuid) FOR UPDATE`;
  }
  private async eachInvoice(
    where: Prisma.InvoiceWhereInput,
    action: (id: string) => Promise<void>,
  ) {
    let cursor: string | undefined;
    for (;;) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: this.policy.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const invoice of invoices) await action(invoice.id);
      if (invoices.length < this.policy.batchSize) break;
      cursor = invoices[invoices.length - 1].id;
    }
  }
  async customerSummary(actor: AuthenticatedUser) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customer: { userId: actor.id },
        status: { in: unpaid },
        dueDate: { lt: new Date() },
      },
      include: collectionInvoiceInclude,
      orderBy: { dueDate: 'asc' },
    });
    const restorationProcessing = !!(await this.prisma.subscription.findFirst({
      where: {
        customer: { userId: actor.id },
        status: SubscriptionStatus.SUSPENDED,
        suspensionReason: SuspensionReason.NON_PAYMENT,
        provisioningRequests: {
          some: {
            action: ServiceProvisioningAction.RESTORE,
            status: { in: [ServiceProvisioningStatus.PENDING, ServiceProvisioningStatus.FAILED] },
          },
        },
      },
      select: { id: true },
    }));
    const policy = await this.policy.get();
    const payable = invoices.filter((invoice) => payableCents(invoice) > 0);
    const suspended = payable.some(
      (invoice) =>
        invoice.subscription?.status === SubscriptionStatus.SUSPENDED &&
        invoice.subscription.suspensionReason === SuspensionReason.NON_PAYMENT,
    );
    let blocked = payable.some(
      (invoice) =>
        invoice.subscription?.collectionHoldReason ||
        invoice.payments.some(
          (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
        ),
    );
    const subscriptionIds = [
      ...new Set(
        payable.flatMap((invoice) => (invoice.subscriptionId ? [invoice.subscriptionId] : [])),
      ),
    ];
    if (subscriptionIds.length) {
      const [relocation, cancellation, credits] = await Promise.all([
        this.prisma.serviceRelocation.count({
          where: {
            subscriptionId: { in: subscriptionIds },
            status: { notIn: ['COMPLETED', 'CANCELLED', 'FORCE_CLOSED', 'REJECTED'] },
          },
        }),
        this.prisma.cancellationRequest.count({
          where: {
            subscriptionId: { in: subscriptionIds },
            status: { notIn: ['COMPLETED', 'REVOKED', 'REJECTED'] },
          },
        }),
        this.prisma.accountTransaction.count({
          where: {
            customer: { userId: actor.id },
            type: 'CREDIT',
            status: { in: ['AVAILABLE', 'PARTIALLY_USED', 'APPROVED'] },
            remainingAmountCents: { gt: 0 },
            OR: [{ subscriptionId: null }, { subscriptionId: { in: subscriptionIds } }],
          },
        }),
      ]);
      blocked =
        blocked ||
        !!relocation ||
        !!cancellation ||
        !!credits ||
        payable.some(
          (invoice) =>
            invoice.stripeNextPaymentAttempt && invoice.stripeNextPaymentAttempt > new Date(),
        );
    }
    const dates = payable
      .filter(
        (invoice) =>
          invoice.subscription &&
          [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
            (status) => status === invoice.subscription!.status,
          ),
      )
      .map((invoice) =>
        suspensionDate(
          invoice,
          invoice.subscription!.graceExtendedUntil,
          policy,
          this.policy.dayMilliseconds,
        ),
      );
    return {
      restorationProcessing,
      overdueCents: payable.reduce((sum, invoice) => sum + payableCents(invoice), 0),
      suspended,
      paymentProcessing: blocked,
      suspensionDate:
        !blocked && dates.length
          ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString()
          : null,
      invoiceId: payable[0]?.id ?? null,
    };
  }
  async markOverdue(now = new Date()): Promise<number> {
    let count = 0;
    await this.eachInvoice(
      { status: { in: unpaid }, dueDate: { lt: now }, subscriptionId: { not: null } },
      async (id) => {
        const changed = await this.transaction(async (tx) => {
          let invoice = await tx.invoice.findUnique({
            where: { id },
            include: collectionInvoiceInclude,
          });
          if (!invoice?.subscription || !unpaid.includes(invoice.status) || invoice.dueDate >= now)
            return false;
          await this.lock(tx, invoice.subscription.id);
          if (
            invoice.type === InvoiceType.MANUAL &&
            !invoice.payments.some(
              (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
            )
          ) {
            await this.ledger.applyOverdueInvoiceCredits(tx, invoice, payableCents(invoice));
            invoice = await tx.invoice.findUniqueOrThrow({
              where: { id },
              include: collectionInvoiceInclude,
            });
          }
          if (payableCents(invoice) === 0) {
            if (invoice.status !== InvoiceStatus.PAID && invoice.status !== InvoiceStatus.CANCELLED)
              await tx.invoice.update({
                where: { id },
                data: { status: InvoiceStatus.PAID, paidAt: now },
              });
            return false;
          }
          if (invoice.subscription) {
            const policy = await this.policy.get(tx);
            const date = suspensionDate(
              invoice,
              invoice.subscription.graceExtendedUntil,
              policy,
              this.policy.dayMilliseconds,
            );
            const previousDate = invoice.subscription.gracePeriodEndsAt;
            if (!previousDate || date < previousDate)
              await tx.subscription.update({
                where: { id: invoice.subscription.id },
                data: {
                  gracePeriodEndsAt: date,
                  eligibleForTerminationAt: new Date(
                    date.getTime() +
                      Math.max(0, this.policy.terminationDays - policy.suspensionDays) *
                        this.policy.dayMilliseconds,
                  ),
                },
              });
          }
          if (invoice.status === InvoiceStatus.OVERDUE) return false;
          await tx.invoice.update({
            where: { id },
            data: { status: InvoiceStatus.OVERDUE, overdueAt: invoice.dueDate },
          });
          await tx.auditLog.create({
            data: {
              deduplicationKey: `${id}-INVOICE_BECAME_OVERDUE`,
              action: 'INVOICE_BECAME_OVERDUE',
              entityType: 'Invoice',
              entityId: id,
              metadata: { subscriptionId: invoice.subscriptionId },
            },
          });
          return true;
        });
        if (changed) count++;
      },
    );
    await this.reconcileSettled(now);
    if (count) await this.cache.invalidate();
    return count;
  }
  async warnings(now = new Date()): Promise<number> {
    await this.eachInvoice(
      {
        status: InvoiceStatus.OVERDUE,
        collectionStage: { notIn: [CollectionStage.RESOLVED, CollectionStage.SUSPENDED] },
      },
      async (id) => {
        await this.transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id },
            include: collectionInvoiceInclude,
          });
          if (
            !invoice?.subscription ||
            invoice.status !== InvoiceStatus.OVERDUE ||
            payableCents(invoice) <= 0
          )
            return;
          await this.lock(tx, invoice.subscription.id);
          const policy = await this.policy.get(tx);
          const event = nextWarning(invoice, now, policy, this.policy.dayMilliseconds);
          if (event) await this.intent(tx, invoice, event, `${id}-${event}`, 'SYSTEM');
          if (invoice.finalWarningSentAt) {
            const date = suspensionDate(
              invoice,
              invoice.subscription.graceExtendedUntil,
              policy,
              this.policy.dayMilliseconds,
            );
            await tx.invoice.update({
              where: { id },
              data: {
                collectionStage: CollectionStage.SUSPENSION_SCHEDULED,
                suspensionScheduledAt: date,
              },
            });
            await tx.subscription.update({
              where: { id: invoice.subscription.id },
              data: {
                gracePeriodEndsAt: date,
                eligibleForTerminationAt: new Date(
                  date.getTime() +
                    Math.max(0, this.policy.terminationDays - policy.suspensionDays) *
                      this.policy.dayMilliseconds,
                ),
              },
            });
            await tx.auditLog.upsert({
              where: { deduplicationKey: `${id}-SUSPENSION_SCHEDULED` },
              create: {
                action: 'SUSPENSION_SCHEDULED',
                entityType: 'Invoice',
                entityId: id,
                deduplicationKey: `${id}-SUSPENSION_SCHEDULED`,
                metadata: {
                  subscriptionId: invoice.subscriptionId,
                  suspensionDate: date.toISOString(),
                },
              },
              update: {},
            });
          }
        });
      },
    );
    return this.deliver(now);
  }
  async suspend(now = new Date()): Promise<number> {
    let count = 0;
    await this.eachInvoice(
      {
        status: InvoiceStatus.OVERDUE,
        collectionStage: CollectionStage.SUSPENSION_SCHEDULED,
        suspensionScheduledAt: { lte: now },
      },
      async (id) => {
        const requested = await this.transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id },
            include: collectionInvoiceInclude,
          });
          if (
            !invoice?.subscription ||
            invoice.status !== InvoiceStatus.OVERDUE ||
            payableCents(invoice) <= 0
          )
            return false;
          const sub = invoice.subscription;
          await this.lock(tx, sub.id);
          const policy = await this.policy.get(tx);
          if (
            !invoice.firstReminderSentAt ||
            !invoice.secondReminderSentAt ||
            !invoice.finalWarningSentAt ||
            suspensionDate(invoice, sub.graceExtendedUntil, policy, this.policy.dayMilliseconds) >
              now ||
            ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
              (status) => status === sub.status,
            ) ||
            sub.collectionHoldReason
          )
            return false;
          const invoices = await tx.invoice.findMany({
            where: { subscriptionId: sub.id, status: { in: unpaid } },
            include: { payments: true },
          });
          if (
            invoices.some(
              (i) =>
                i.payments.some(
                  (p) =>
                    p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
                ) ||
                (i.stripeNextPaymentAttempt && i.stripeNextPaymentAttempt > now),
            )
          ) {
            if (
              invoices.some((i) =>
                i.payments.some(
                  (p) =>
                    (p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING) &&
                    p.createdAt.getTime() + policy.suspensionDays * this.policy.dayMilliseconds <=
                      now.getTime(),
                ),
              )
            ) {
              await tx.auditLog.upsert({
                where: { deduplicationKey: `${id}-PENDING_PAYMENT_REVIEW` },
                create: {
                  deduplicationKey: `${id}-PENDING_PAYMENT_REVIEW`,
                  action: 'COLLECTION_REVIEW_REQUIRED',
                  entityType: 'Invoice',
                  entityId: id,
                  notificationEvent: 'COLLECTION_REVIEW_REQUIRED',
                  metadata: {
                    subscriptionId: sub.id,
                    reason: 'PAYMENT_PROCESSING_REQUIRES_REVIEW',
                  },
                },
                update: {},
              });
            }
            return false;
          }
          const unsettledCredits =
            sub.billingMode === 'STRIPE_RECURRING'
              ? await tx.accountTransaction.count({
                  where: {
                    customerId: sub.customerId,
                    type: 'CREDIT',
                    status: { in: ['AVAILABLE', 'PARTIALLY_USED', 'APPROVED'] },
                    remainingAmountCents: { gt: 0 },
                    OR: [{ subscriptionId: null }, { subscriptionId: sub.id }],
                  },
                })
              : 0;
          const relocation = await tx.serviceRelocation.count({
            where: {
              subscriptionId: sub.id,
              status: { notIn: ['COMPLETED', 'CANCELLED', 'FORCE_CLOSED', 'REJECTED'] },
            },
          });
          const cancellation = await tx.cancellationRequest.count({
            where: {
              subscriptionId: sub.id,
              status: { notIn: ['COMPLETED', 'REVOKED', 'REJECTED'] },
            },
          });
          if (relocation || cancellation || unsettledCredits) {
            await tx.auditLog.upsert({
              where: { deduplicationKey: `${id}-COLLECTION_REVIEW` },
              create: {
                deduplicationKey: `${id}-COLLECTION_REVIEW`,
                action: 'COLLECTION_REVIEW_REQUIRED',
                entityType: 'Invoice',
                entityId: id,
                notificationEvent: 'COLLECTION_REVIEW_REQUIRED',
                metadata: { subscriptionId: sub.id },
              },
              update: {},
            });
            return false;
          }
          const key = `collection-suspend-${id}`;
          const existing = await tx.serviceProvisioningRequest.findUnique({
            where: { idempotencyKey: key },
          });
          if (existing && existing.failureReason !== 'COLLECTION_NO_LONGER_APPLICABLE')
            return false;
          await tx.serviceProvisioningRequest.upsert({
            where: { idempotencyKey: key },
            create: {
              subscriptionId: sub.id,
              action: ServiceProvisioningAction.SUSPEND,
              collectionInvoiceId: id,
              idempotencyKey: key,
            },
            update: {
              status: ServiceProvisioningStatus.PENDING,
              failureReason: null,
              notificationDeliveredAt: null,
            },
          });
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              provisioningStatus: ServiceProvisioningStatus.PENDING,
              provisioningFailure: null,
            },
          });
          return true;
        });
        if (requested) count++;
      },
    );
    return count;
  }
  async confirmedPayment(invoiceId: string, now = new Date()): Promise<void> {
    await this.transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: collectionInvoiceInclude,
      });
      if (
        !invoice?.subscription ||
        payableCents(invoice) > 0 ||
        invoice.status === InvoiceStatus.CANCELLED
      )
        return;
      const sub = invoice.subscription;
      await this.lock(tx, sub.id);
      if (
        invoice.collectionStage !== CollectionStage.NONE &&
        invoice.collectionStage !== CollectionStage.RESOLVED
      ) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { collectionStage: CollectionStage.RESOLVED },
        });
        await tx.auditLog.upsert({
          where: { deduplicationKey: `${invoice.id}-COLLECTION_RESOLVED` },
          create: {
            deduplicationKey: `${invoice.id}-COLLECTION_RESOLVED`,
            action: 'COLLECTION_RESOLVED',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: { subscriptionId: sub.id },
          },
          update: {},
        });
      }
      const outstanding = await tx.invoice.findMany({
        where: { subscriptionId: sub.id, status: { in: unpaid }, dueDate: { lte: now } },
        include: { payments: true },
      });
      if (outstanding.some((i) => payableCents(i) > 0)) return;
      if (
        sub.status === SubscriptionStatus.SUSPENDED &&
        sub.suspensionReason === SuspensionReason.NON_PAYMENT
      ) {
        const key = `collection-restore-${sub.id}-${sub.suspendedAt?.getTime() ?? invoice.id}`;
        const existing = await tx.serviceProvisioningRequest.findUnique({
          where: { idempotencyKey: key },
        });
        await tx.serviceProvisioningRequest.upsert({
          where: { idempotencyKey: key },
          create: {
            subscriptionId: sub.id,
            collectionInvoiceId: invoice.id,
            action: ServiceProvisioningAction.RESTORE,
            idempotencyKey: key,
          },
          update:
            existing?.failureReason === 'COLLECTION_NO_LONGER_APPLICABLE'
              ? {
                  status: ServiceProvisioningStatus.PENDING,
                  failureReason: null,
                  notificationDeliveredAt: null,
                }
              : {},
        });
        await tx.subscription.update({
          where: { id: sub.id },
          data: { provisioningStatus: ServiceProvisioningStatus.PENDING },
        });
      } else if (
        [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
          (status) => status === sub.status,
        )
      ) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            pastDueAt: null,
            gracePeriodEndsAt: null,
            graceExtendedUntil: null,
            eligibleForTerminationAt: null,
          },
        });
      }
    });
    await this.cache.invalidate();
  }
  private async reconcileSettled(now: Date) {
    await this.eachInvoice(
      {
        status: InvoiceStatus.PAID,
        collectionStage: { notIn: [CollectionStage.NONE, CollectionStage.RESOLVED] },
      },
      (id) => this.confirmedPayment(id, now),
    );
    // Repair the webhook-to-provisioning crash window even after invoice collection was resolved.
    const suspended = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.SUSPENDED,
        suspensionReason: SuspensionReason.NON_PAYMENT,
      },
      select: {
        invoices: {
          where: { status: InvoiceStatus.PAID },
          select: { id: true },
          take: 1,
          orderBy: { paidAt: 'desc' },
        },
      },
    });
    for (const sub of suspended)
      if (sub.invoices[0]) await this.confirmedPayment(sub.invoices[0].id, now);
  }
  private async intent(
    tx: Prisma.TransactionClient,
    invoice: CollectionInvoice,
    event: OverdueEmailEvent,
    key: string,
    actorId: string,
  ) {
    await tx.auditLog.upsert({
      where: { deduplicationKey: key },
      create: {
        deduplicationKey: key,
        action: event === 'MANUAL_REMINDER' ? 'MANUAL_PAYMENT_REMINDER_SENT' : `${event}_SENT`,
        entityType: 'Invoice',
        entityId: invoice.id,
        actorUserId: actorId === 'SYSTEM' ? null : actorId,
        notificationEvent: event,
        metadata: { subscriptionId: invoice.subscriptionId, invoiceId: invoice.id },
      },
      update: {},
    });
  }
  async deliver(now = new Date()): Promise<number> {
    const events = await this.prisma.auditLog.findMany({
      where: { notificationEvent: { not: null }, notificationDeliveredAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.policy.batchSize,
    });
    let delivered = 0;
    for (const entry of events) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: entry.entityId },
        include: collectionInvoiceInclude,
      });
      if (!invoice?.subscription) continue;
      const event = entry.notificationEvent;
      if (event === 'COLLECTION_REVIEW_REQUIRED') {
        await this.notifications.sendPaymentReviewRequired({
          invoiceId: invoice.id,
          idempotencyKey: entry.id,
        });
      } else {
        if (!isCollectionEmailEvent(event)) continue;
        if (
          (event === 'SERVICE_SUSPENDED' &&
            (invoice.subscription.status !== SubscriptionStatus.SUSPENDED ||
              invoice.subscription.suspensionReason !== SuspensionReason.NON_PAYMENT)) ||
          (event === 'SERVICE_RESTORED' &&
            invoice.subscription.status !== SubscriptionStatus.ACTIVE)
        ) {
          await this.prisma.auditLog.update({
            where: { id: entry.id },
            data: { notificationDeliveredAt: now },
          });
          continue;
        }
        if (
          reminderEvents.some((e) => e === event) &&
          (invoice.status !== InvoiceStatus.OVERDUE || payableCents(invoice) <= 0)
        ) {
          await this.prisma.auditLog.update({
            where: { id: entry.id },
            data: { notificationDeliveredAt: now },
          });
          continue;
        }
        const policy = await this.policy.get();
        let date = suspensionDate(
          invoice,
          invoice.subscription.graceExtendedUntil,
          policy,
          this.policy.dayMilliseconds,
        );
        if (event === 'FINAL_WARNING')
          date = new Date(
            Math.max(
              date.getTime(),
              now.getTime() +
                (policy.suspensionDays - policy.finalWarningDays) * this.policy.dayMilliseconds,
            ),
          );
        await this.notifications.sendOverdueLifecycleNotification({
          event,
          subscriptionId: invoice.subscription.id,
          invoiceId: invoice.id,
          customerEmail: invoice.customer.email,
          customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
          userId: invoice.customer.userId,
          invoiceNumber: invoice.invoiceNumber,
          amountCents: payableCents(invoice),
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          gracePeriodEndsAt: date,
          suspendedAt: invoice.subscription.suspendedAt,
          idempotencySuffix: entry.id,
        });
        const data: Prisma.InvoiceUpdateManyMutationInput =
          event === 'FIRST_REMINDER'
            ? {
                firstReminderSentAt: now,
                collectionStage: CollectionStage.FIRST_REMINDER,
                suspensionScheduledAt: date,
              }
            : event === 'SECOND_REMINDER'
              ? {
                  secondReminderSentAt: now,
                  collectionStage: CollectionStage.SECOND_REMINDER,
                  suspensionScheduledAt: date,
                }
              : event === 'FINAL_WARNING'
                ? {
                    finalWarningSentAt: now,
                    collectionStage: CollectionStage.FINAL_WARNING,
                    suspensionScheduledAt: new Date(
                      Math.max(
                        date.getTime(),
                        now.getTime() +
                          (policy.suspensionDays - policy.finalWarningDays) *
                            this.policy.dayMilliseconds,
                      ),
                    ),
                  }
                : {};
        await this.transaction(async (tx) => {
          await tx.invoice.updateMany({
            where: {
              id: invoice.id,
              status: InvoiceStatus.OVERDUE,
              ...(event === 'FIRST_REMINDER'
                ? { firstReminderSentAt: null }
                : event === 'SECOND_REMINDER'
                  ? { secondReminderSentAt: null }
                  : event === 'FINAL_WARNING'
                    ? { finalWarningSentAt: null }
                    : {}),
            },
            data,
          });
          await tx.auditLog.update({
            where: { id: entry.id },
            data: { notificationDeliveredAt: now },
          });
        });
        delivered++;
        continue;
      }
      await this.prisma.auditLog.update({
        where: { id: entry.id },
        data: { notificationDeliveredAt: now },
      });
      delivered++;
    }
    return delivered;
  }
  async manualReminder(id: string, actor: AuthenticatedUser, requestKey: string = randomUUID()) {
    await this.transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: collectionInvoiceInclude,
      });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status !== InvoiceStatus.OVERDUE || payableCents(invoice) <= 0)
        throw new BadRequestException(
          'Only outstanding overdue invoices can receive collection reminders.',
        );
      await this.intent(tx, invoice, 'MANUAL_REMINDER', `${id}-manual-${requestKey}`, actor.id);
    });
    await this.deliver();
    return { queued: true };
  }
  async history(id: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { subscriptionId: id },
      select: { id: true },
    });
    return this.prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Subscription', entityId: id },
          { entityType: 'Invoice', entityId: { in: invoices.map((i) => i.id) } },
        ],
      },
      select: {
        id: true,
        action: true,
        actorUserId: true,
        metadata: true,
        createdAt: true,
        notificationDeliveredAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: this.policy.batchSize,
    });
  }
  async setHold(id: string, reason: string, actor: AuthenticatedUser) {
    return this.transaction(async (tx) => {
      const subscription = await tx.subscription.update({
        where: { id },
        data: { collectionHoldReason: reason.trim() || null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'COLLECTION_HOLD_UPDATED',
          entityType: 'Subscription',
          entityId: id,
          metadata: { reason },
        },
      });
      return subscription;
    });
  }
}
function isCollectionEmailEvent(value: string | null): value is OverdueEmailEvent {
  return (
    value !== null &&
    [
      'FIRST_REMINDER',
      'SECOND_REMINDER',
      'FINAL_WARNING',
      'MANUAL_REMINDER',
      'GRACE_PERIOD_EXTENDED',
      'SERVICE_SUSPENDED',
      'SERVICE_RESTORED',
      'SERVICE_RESTORATION_REQUESTED',
    ].includes(value)
  );
}
