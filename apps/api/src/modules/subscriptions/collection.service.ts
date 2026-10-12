import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CollectionStage,
  InvoiceStatus,
  InvoiceType,
  PaymentStatus,
  Prisma,
  Role,
  ServiceProvisioningAction,
  ServiceProvisioningStatus,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';
import { hasActiveCollectionHold, collectionHoldState } from './collection-hold.policy';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { AccountLedgerService } from '../account-ledger/account-ledger.service';
import { NotificationService } from '../notifications/notification.service';
import type { OverdueEmailEvent } from '../notifications/templates/overdue-email.template';
import { CollectionPolicyService, type CollectionSettings } from './collection-policy.service';
import {
  collectionExtension,
  finalWarningAllowsSuspension,
  hasIssuedFinalWarning,
  nextWarning,
  payableCents,
  RECOVERY_WINDOW_MS,
  suspensionDate,
} from './collection-deadline';

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
  'RECOVERY_FINAL_WARNING',
  'MANUAL_REMINDER',
] as const;

export { nextWarning, payableCents, suspensionDate } from './collection-deadline';

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
          timeout: 15000,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !(
            error.code === 'P2034' ||
            (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
          ) ||
          attempt >= 4
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
        hasActiveCollectionHold(invoice.subscription!, new Date()) ||
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
          collectionExtension(
            invoice.subscription!.graceExtendedUntil,
            payable.filter((i) => i.subscriptionId === invoice.subscriptionId),
          ),
          policy,
          this.policy.dayMilliseconds,
        ),
      );
    // Rank recorded stages, without advancing the policy clock or counting manual reminders.
    const stageOrder: Record<CollectionStage, number> = {
      NONE: 0,
      FIRST_REMINDER: 1,
      SECOND_REMINDER: 2,
      FINAL_WARNING: 3,
      SUSPENSION_SCHEDULED: 3,
      SUSPENDED: 4,
      RESOLVED: 0,
    };
    const rankInvoice = (invoice: CollectionInvoice) =>
      invoice.subscription?.status === SubscriptionStatus.SUSPENDED &&
      invoice.subscription.suspensionReason === SuspensionReason.NON_PAYMENT
        ? 4
        : invoice.recoveryFinalWarningSentAt
          ? 3.5
          : stageOrder[invoice.collectionStage];
    const currentInvoice = [...payable].sort((a, b) => rankInvoice(b) - rankInvoice(a))[0];
    return {
      collectionStage: suspended
        ? CollectionStage.SUSPENDED
        : (currentInvoice?.collectionStage ?? CollectionStage.NONE),
      recoveryFinalWarning: Boolean(currentInvoice?.recoveryFinalWarningSentAt),
      restorationProcessing,
      overdueCents: payable.reduce((sum, invoice) => sum + payableCents(invoice), 0),
      suspended,
      collectionOnHold: payable.some(
        (i) => i.subscription && hasActiveCollectionHold(i.subscription),
      ),
      paymentProcessing: blocked,
      suspensionDate:
        !blocked && dates.length
          ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString()
          : null,
      invoiceId: currentInvoice?.id ?? null,
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
          await this.ensureDeadline(tx, invoice, now);
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
    await this.reconcileHolds(now);
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
          if (
            ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
              (status) => status === invoice.subscription!.status,
            )
          )
            return;
          if (hasActiveCollectionHold(invoice.subscription, now)) return;
          const current = await this.ensureDeadline(tx, invoice, now);
          const policy = await this.policy.get(tx);
          const event = nextWarning(
            current,
            now,
            policy,
            this.policy.dayMilliseconds,
            current.subscription!.graceExtendedUntil,
          );
          if (event === 'RECOVERY_FINAL_WARNING') await this.prepareRecovery(tx, current, now);
          else if (event) await this.intent(tx, current, event, `${id}-${event}`, 'SYSTEM');
          if (
            current.recoverySuspensionDeadline &&
            !hasIssuedFinalWarning(current) &&
            suspensionDate(
              current,
              current.subscription!.graceExtendedUntil,
              policy,
              this.policy.dayMilliseconds,
            ) <= now
          )
            await this.recoveryReview(tx, current);
          if (hasIssuedFinalWarning(current)) await this.schedule(tx, current, policy, now);
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
          const invoices = await tx.invoice.findMany({
            where: { subscriptionId: sub.id, status: { in: unpaid } },
            include: { payments: true },
          });
          const policy = await this.policy.get(tx);
          if (
            !finalWarningAllowsSuspension(
              invoice,
              suspensionDate(
                invoice,
                collectionExtension(sub.graceExtendedUntil, invoices),
                policy,
                this.policy.dayMilliseconds,
              ),
              now,
            ) ||
            ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
              (status) => status === sub.status,
            ) ||
            hasActiveCollectionHold(sub, now)
          )
            return false;
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
        (invoice.collectionStage !== CollectionStage.NONE ||
          Boolean(sub.collectionHoldCreatedAt)) &&
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
      if (outstanding.some((i) => payableCents(i) > 0)) {
        await this.syncDeadline(tx, sub.id, await this.policy.get(tx), now);
        return;
      }
      if (sub.collectionHoldReason)
        await this.endHold(tx, sub, now, 'COLLECTION_HOLD_RELEASED', null, 'BALANCE_SETTLED');
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
        OR: [
          { collectionStage: { notIn: [CollectionStage.NONE, CollectionStage.RESOLVED] } },
          {
            collectionStage: CollectionStage.NONE,
            subscription: { collectionHoldCreatedAt: { not: null } },
          },
        ],
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
  private async skip(
    tx: Prisma.TransactionClient,
    entry: { id: string; metadata: Prisma.JsonValue | null },
    now: Date,
    reason: string,
  ) {
    await tx.auditLog.update({
      where: { id: entry.id },
      data: {
        notificationDeliveredAt: now,
        metadata: {
          ...(typeof entry.metadata === 'object' && entry.metadata && !Array.isArray(entry.metadata)
            ? entry.metadata
            : {}),
          notificationOutcome: 'SKIPPED',
          reason,
        },
      },
    });
  }
  private async ensureDeadline(
    tx: Prisma.TransactionClient,
    invoice: CollectionInvoice,
    now: Date,
  ) {
    const policy = await this.policy.get(tx);
    const original =
      invoice.originalSuspensionDeadline ??
      new Date(invoice.dueDate.getTime() + policy.suspensionDays * this.policy.dayMilliseconds);
    const siblings = await tx.invoice.findMany({
      where: { subscriptionId: invoice.subscriptionId, status: { in: unpaid } },
      include: { payments: true },
    });
    const extension = collectionExtension(invoice.subscription!.graceExtendedUntil, siblings);
    const date = suspensionDate(
      { ...invoice, originalSuspensionDeadline: original },
      extension,
      policy,
      this.policy.dayMilliseconds,
    );
    const current = await tx.invoice.update({
      where: { id: invoice.id },
      data: { originalSuspensionDeadline: original, suspensionScheduledAt: date },
      include: collectionInvoiceInclude,
    });
    await this.syncDeadline(tx, invoice.subscriptionId!, policy, now);
    return {
      ...current,
      subscription: current.subscription
        ? { ...current.subscription, graceExtendedUntil: extension }
        : null,
    };
  }
  private async syncDeadline(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    policy: CollectionSettings,
    now: Date,
  ) {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const invoices = await tx.invoice.findMany({
      where: { subscriptionId, status: { in: unpaid }, dueDate: { lt: now } },
      include: { payments: true },
    });
    const extension = collectionExtension(sub.graceExtendedUntil, invoices);
    const dates = invoices
      .filter((i) => payableCents(i) > 0)
      .map((i) => suspensionDate(i, extension, policy, this.policy.dayMilliseconds));
    if (!dates.length) return;
    for (const invoice of invoices.filter((i) => payableCents(i) > 0)) {
      const effective = suspensionDate(invoice, extension, policy, this.policy.dayMilliseconds);
      if (invoice.suspensionScheduledAt?.getTime() !== effective.getTime())
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { suspensionScheduledAt: effective },
        });
    }
    const date = new Date(Math.min(...dates.map((d) => d.getTime())));
    await tx.subscription.update({
      where: { id: subscriptionId },
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
  private async recoveryReview(tx: Prisma.TransactionClient, invoice: CollectionInvoice) {
    await tx.auditLog.upsert({
      where: { deduplicationKey: `${invoice.id}-RECOVERY_DELIVERY_REVIEW` },
      create: {
        deduplicationKey: `${invoice.id}-RECOVERY_DELIVERY_REVIEW`,
        action: 'COLLECTION_REVIEW_REQUIRED',
        entityType: 'Invoice',
        entityId: invoice.id,
        notificationEvent: 'COLLECTION_REVIEW_REQUIRED',
        metadata: {
          subscriptionId: invoice.subscriptionId,
          reason: 'RECOVERY_WARNING_NOT_ISSUED_BEFORE_DEADLINE',
        },
      },
      update: {},
    });
  }
  private async prepareRecovery(
    tx: Prisma.TransactionClient,
    invoice: CollectionInvoice,
    now: Date,
  ) {
    if (hasIssuedFinalWarning(invoice) || payableCents(invoice) <= 0) return;
    const deadline =
      invoice.recoverySuspensionDeadline ?? new Date(now.getTime() + RECOVERY_WINDOW_MS);
    if (!invoice.recoverySuspensionDeadline) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { recoverySuspensionDeadline: deadline, suspensionScheduledAt: deadline },
      });
      for (const action of [
        'ORIGINAL_GRACE_EXPIRED',
        'FINAL_WARNING_MISSED',
        'RECOVERY_SAFETY_EXTENSION',
      ])
        await tx.auditLog.upsert({
          where: { deduplicationKey: `${invoice.id}-${action}` },
          create: {
            deduplicationKey: `${invoice.id}-${action}`,
            action,
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: {
              subscriptionId: invoice.subscriptionId,
              originalDeadline: invoice.originalSuspensionDeadline?.toISOString(),
              recoveryDeadline: deadline.toISOString(),
              hours: 48,
            },
          },
          update: {},
        });
    }
    await this.syncDeadline(tx, invoice.subscriptionId!, await this.policy.get(tx), now);
    await this.intent(
      tx,
      invoice,
      'RECOVERY_FINAL_WARNING',
      `${invoice.id}-RECOVERY_FINAL_WARNING`,
      'SYSTEM',
    );
    const entry = await tx.auditLog.findUnique({
      where: { deduplicationKey: `${invoice.id}-RECOVERY_FINAL_WARNING` },
    });
    const policy = await this.policy.get(tx);
    if (
      entry?.notificationDeliveredAt &&
      entry.metadata &&
      typeof entry.metadata === 'object' &&
      !Array.isArray(entry.metadata) &&
      entry.metadata.notificationOutcome === 'SKIPPED' &&
      suspensionDate(
        { ...invoice, recoverySuspensionDeadline: deadline },
        invoice.subscription!.graceExtendedUntil,
        policy,
        this.policy.dayMilliseconds,
      ) > now
    )
      await tx.auditLog.update({
        where: { id: entry.id },
        data: {
          notificationDeliveredAt: null,
          metadata: { subscriptionId: invoice.subscriptionId, invoiceId: invoice.id },
        },
      });
  }
  private async schedule(
    tx: Prisma.TransactionClient,
    invoice: CollectionInvoice,
    policy: CollectionSettings,
    now: Date,
  ) {
    const date = suspensionDate(
      invoice,
      invoice.subscription!.graceExtendedUntil,
      policy,
      this.policy.dayMilliseconds,
    );
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { collectionStage: CollectionStage.SUSPENSION_SCHEDULED, suspensionScheduledAt: date },
    });
    await this.syncDeadline(tx, invoice.subscriptionId!, policy, now);
    await tx.auditLog.upsert({
      where: { deduplicationKey: `${invoice.id}-SUSPENSION_SCHEDULED` },
      create: {
        deduplicationKey: `${invoice.id}-SUSPENSION_SCHEDULED`,
        action: 'SUSPENSION_SCHEDULED',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: { subscriptionId: invoice.subscriptionId, suspensionDate: date.toISOString() },
      },
      update: {
        metadata: { subscriptionId: invoice.subscriptionId, suspensionDate: date.toISOString() },
      },
    });
  }
  async deliver(now = new Date()): Promise<number> {
    const events = await this.prisma.auditLog.findMany({
      where: { notificationEvent: { not: null }, notificationDeliveredAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.policy.batchSize,
    });
    let delivered = 0;
    for (const item of events) {
      const accepted = await this.transaction(async (tx) => {
        const initial = await tx.invoice.findUnique({
          where: { id: item.entityId },
          include: collectionInvoiceInclude,
        });
        if (!initial?.subscription) return false;
        await this.lock(tx, initial.subscription.id);
        const entry = await tx.auditLog.findUniqueOrThrow({ where: { id: item.id } });
        if (entry.notificationDeliveredAt) return false;
        let invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: initial.id },
          include: collectionInvoiceInclude,
        });
        const event = entry.notificationEvent;
        if (
          ['FIRST_REMINDER', 'SECOND_REMINDER', 'FINAL_WARNING', 'RECOVERY_FINAL_WARNING'].includes(
            event ?? '',
          ) &&
          hasActiveCollectionHold(invoice.subscription!, now)
        )
          return false;
        if (event === 'COLLECTION_REVIEW_REQUIRED') {
          await this.notifications.sendPaymentReviewRequired({
            invoiceId: invoice.id,
            idempotencyKey: entry.id,
          });
        } else {
          if (!isCollectionEmailEvent(event)) return false;
          const reminders =
            reminderEvents.some((e) => e === event) || event === 'GRACE_PERIOD_EXTENDED';
          if (
            reminders &&
            (invoice.status !== InvoiceStatus.OVERDUE ||
              payableCents(invoice) <= 0 ||
              ![SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
                (s) => s === invoice.subscription!.status,
              ))
          ) {
            await this.skip(tx, entry, now, 'COLLECTION_NO_LONGER_APPLICABLE');
            return false;
          }
          if (
            (event === 'SERVICE_SUSPENDED' &&
              (invoice.subscription!.status !== SubscriptionStatus.SUSPENDED ||
                invoice.subscription!.suspensionReason !== SuspensionReason.NON_PAYMENT)) ||
            (event === 'SERVICE_RESTORED' &&
              invoice.subscription!.status !== SubscriptionStatus.ACTIVE)
          ) {
            await this.skip(tx, entry, now, 'SERVICE_STATE_CHANGED');
            return false;
          }
          const policy = await this.policy.get(tx);
          if (reminders) invoice = await this.ensureDeadline(tx, invoice, now);
          const date = suspensionDate(
            invoice,
            invoice.subscription!.graceExtendedUntil,
            policy,
            this.policy.dayMilliseconds,
          );
          if (
            [
              'FIRST_REMINDER',
              'SECOND_REMINDER',
              'FINAL_WARNING',
              'RECOVERY_FINAL_WARNING',
            ].includes(event)
          ) {
            const expected = nextWarning(
              invoice,
              now,
              policy,
              this.policy.dayMilliseconds,
              invoice.subscription!.graceExtendedUntil,
            );
            if (expected !== event || date <= now) {
              if (expected === 'RECOVERY_FINAL_WARNING' && !invoice.recoverySuspensionDeadline)
                await this.prepareRecovery(tx, invoice, now);
              if (
                invoice.recoverySuspensionDeadline &&
                !hasIssuedFinalWarning(invoice) &&
                date <= now
              )
                await this.recoveryReview(tx, invoice);
              await this.skip(tx, entry, now, 'SUPERSEDED_OR_DEADLINE_ELAPSED');
              return false;
            }
          }
          await this.notifications.sendOverdueLifecycleNotification({
            event,
            subscriptionId: invoice.subscription!.id,
            invoiceId: invoice.id,
            customerEmail: invoice.customer.email,
            customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
            userId: invoice.customer.userId,
            invoiceNumber: invoice.invoiceNumber,
            amountCents: payableCents(invoice),
            currency: invoice.currency,
            dueDate: invoice.dueDate,
            gracePeriodEndsAt: date,
            suspendedAt: invoice.subscription!.suspendedAt,
            idempotencySuffix: entry.id,
          });
          const data: Prisma.InvoiceUpdateInput =
            event === 'FIRST_REMINDER'
              ? { firstReminderSentAt: now, collectionStage: CollectionStage.FIRST_REMINDER }
              : event === 'SECOND_REMINDER'
                ? { secondReminderSentAt: now, collectionStage: CollectionStage.SECOND_REMINDER }
                : event === 'FINAL_WARNING'
                  ? { finalWarningSentAt: now, collectionStage: CollectionStage.FINAL_WARNING }
                  : event === 'RECOVERY_FINAL_WARNING'
                    ? {
                        recoveryFinalWarningSentAt: now,
                        collectionStage: CollectionStage.FINAL_WARNING,
                      }
                    : {};
          if (Object.keys(data).length)
            invoice = await tx.invoice.update({
              where: { id: invoice.id },
              data,
              include: collectionInvoiceInclude,
            });
          if (hasIssuedFinalWarning(invoice) && reminders)
            await this.schedule(tx, invoice, policy, now);
        }
        await tx.auditLog.update({
          where: { id: entry.id },
          data: { notificationDeliveredAt: now },
        });
        return true;
      });
      if (accepted) delivered++;
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
  private async holdInvoices(tx: Prisma.TransactionClient, id: string) {
    return tx.invoice.findMany({
      where: { subscriptionId: id },
      include: { payments: true },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
  }
  private async endHold(
    tx: Prisma.TransactionClient,
    sub: Prisma.SubscriptionGetPayload<object>,
    now: Date,
    action: 'COLLECTION_HOLD_RELEASED' | 'COLLECTION_HOLD_EXPIRED',
    actorId: string | null,
    reason: string,
  ) {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        collectionHoldReason: null,
        collectionHoldNotes: null,
        collectionHoldUntil: null,
        collectionHoldReleasedBy: actorId,
        collectionHoldReleasedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        action,
        entityType: 'Subscription',
        entityId: sub.id,
        actorUserId: actorId,
        metadata: {
          reason,
          holdReason: sub.collectionHoldReason,
          notes: sub.collectionHoldNotes,
          previousDeadline: sub.collectionHoldUntil?.toISOString() ?? null,
          createdBy: sub.collectionHoldCreatedBy,
          createdAt: sub.collectionHoldCreatedAt?.toISOString() ?? null,
        },
      },
    });
  }
  private async reconcileHolds(now: Date) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { collectionHoldReason: { not: null } },
      select: { id: true },
    });
    for (const candidate of subscriptions) {
      const settled = await this.transaction(async (tx) => {
        await this.lock(tx, candidate.id);
        const sub = await tx.subscription.findUniqueOrThrow({ where: { id: candidate.id } });
        if (!sub.collectionHoldReason) return [];
        const invoices = await this.holdInvoices(tx, sub.id);
        const state = collectionHoldState(sub, invoices, now);
        if (state.inconsistent) await this.recordHoldInconsistency(tx, sub.id);
        if (!state.canPlace && !state.canUpdate) {
          await this.endHold(
            tx,
            sub,
            now,
            'COLLECTION_HOLD_RELEASED',
            null,
            state.inconsistent
              ? 'PENDING_SERVICE_REQUIRES_REVIEW'
              : 'NO_UNRESOLVED_OVERDUE_BALANCE',
          );
          return invoices
            .filter((i) => i.status === InvoiceStatus.PAID && payableCents(i) === 0)
            .map((i) => i.id);
        }
        if (sub.collectionHoldUntil && sub.collectionHoldUntil <= now)
          await this.endHold(
            tx,
            sub,
            now,
            'COLLECTION_HOLD_EXPIRED',
            null,
            'HOLD_DEADLINE_REACHED',
          );
        return [];
      });
      for (const id of settled) await this.confirmedPayment(id, now);
    }
  }
  private async recordHoldInconsistency(tx: Prisma.TransactionClient, id: string) {
    await tx.auditLog.upsert({
      where: { deduplicationKey: `${id}-PENDING_COLLECTION_REVIEW` },
      create: {
        deduplicationKey: `${id}-PENDING_COLLECTION_REVIEW`,
        action: 'COLLECTION_DATA_REVIEW_REQUIRED',
        entityType: 'Subscription',
        entityId: id,
        metadata: {
          reason:
            'Pending service has unresolved overdue debt; investigate activation and billing records.',
        },
      },
      update: {},
    });
  }
  async setHold(
    id: string,
    reason: string,
    actor: AuthenticatedUser,
    details: { notes?: string | null; holdUntil?: string | null } = {},
  ) {
    this.assertHoldActor(actor);
    const cleanReason = reason.trim();
    const notes = details.notes?.trim() || null;
    const now = new Date();
    const until = details.holdUntil ? new Date(details.holdUntil) : null;
    if (
      cleanReason.length < 3 ||
      cleanReason.length > 1000 ||
      (notes?.length ?? 0) > 2000 ||
      (until && (!Number.isFinite(until.getTime()) || until <= now))
    )
      throw new BadRequestException(
        'A collection hold requires a meaningful reason and a future hold deadline, if provided.',
      );
    const result = await this.transaction(async (tx) => {
      await this.lock(tx, id);
      const sub = await tx.subscription.findUnique({ where: { id } });
      if (!sub) throw new NotFoundException('Subscription not found.');
      let invoices = await this.holdInvoices(tx, id);
      // Apply actual approved manual credits using the existing ledger, never invoice face value.
      for (const invoice of invoices)
        if (
          invoice.type === InvoiceType.MANUAL &&
          invoice.status === InvoiceStatus.OVERDUE &&
          invoice.dueDate < now &&
          !invoice.payments.some(
            (p) => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.PROCESSING,
          )
        )
          await this.ledger.applyOverdueInvoiceCredits(tx, invoice, payableCents(invoice));
      invoices = await this.holdInvoices(tx, id);
      const state = collectionHoldState(sub, invoices, now);
      if (state.inconsistent) await this.recordHoldInconsistency(tx, id);
      const settled = invoices
        .filter((i) => i.status === InvoiceStatus.PAID && payableCents(i) === 0)
        .map((i) => i.id);
      if (!state.canPlace && !state.canUpdate) {
        if (sub.collectionHoldReason)
          await this.endHold(
            tx,
            sub,
            now,
            'COLLECTION_HOLD_RELEASED',
            null,
            'NO_UNRESOLVED_OVERDUE_BALANCE',
          );
        return { error: state.message, settled };
      }
      const same =
        state.active &&
        sub.collectionHoldReason === cleanReason &&
        sub.collectionHoldNotes === notes &&
        (sub.collectionHoldUntil?.getTime() ?? null) === (until?.getTime() ?? null);
      if (!same) {
        if (
          sub.collectionHoldReason &&
          !state.active &&
          sub.collectionHoldUntil &&
          sub.collectionHoldUntil <= now
        )
          await this.endHold(
            tx,
            sub,
            now,
            'COLLECTION_HOLD_EXPIRED',
            null,
            'HOLD_DEADLINE_REACHED',
          );
        await tx.subscription.update({
          where: { id },
          data: {
            collectionHoldReason: cleanReason,
            collectionHoldNotes: notes,
            collectionHoldUntil: until,
            ...(!state.active
              ? {
                  collectionHoldCreatedBy: actor.id,
                  collectionHoldCreatedAt: now,
                  collectionHoldReleasedBy: null,
                  collectionHoldReleasedAt: null,
                }
              : {}),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: state.active ? 'COLLECTION_HOLD_UPDATED' : 'COLLECTION_HOLD_CREATED',
            entityType: 'Subscription',
            entityId: id,
            metadata: {
              reason: cleanReason,
              notes,
              previousDeadline: sub.collectionHoldUntil?.toISOString() ?? null,
              newDeadline: until?.toISOString() ?? null,
              collectibleCents: state.collectibleCents,
            },
          },
        });
      }
      return { error: null, settled };
    });
    for (const invoiceId of result.settled) await this.confirmedPayment(invoiceId, now);
    await this.cache.invalidate();
    if (result.error) throw new BadRequestException(result.error);
    return this.prisma.subscription.findUniqueOrThrow({ where: { id } });
  }
  async releaseHold(id: string, actor: AuthenticatedUser, confirmed: boolean) {
    this.assertHoldActor(actor);
    if (confirmed !== true)
      throw new BadRequestException('Confirm release of the collection hold.');
    const now = new Date();
    await this.transaction(async (tx) => {
      await this.lock(tx, id);
      const sub = await tx.subscription.findUnique({ where: { id } });
      if (!sub) throw new NotFoundException('Subscription not found.');
      if (!sub.collectionHoldReason) return;
      await this.endHold(
        tx,
        sub,
        now,
        sub.collectionHoldUntil && sub.collectionHoldUntil <= now
          ? 'COLLECTION_HOLD_EXPIRED'
          : 'COLLECTION_HOLD_RELEASED',
        actor.id,
        'MANUAL_RELEASE',
      );
    });
    // The normal scheduler reloads balances and selects a safe action; release itself sends nothing.
    await this.cache.invalidate();
    return this.prisma.subscription.findUniqueOrThrow({ where: { id } });
  }
  private assertHoldActor(actor: AuthenticatedUser) {
    if (![Role.ADMIN, Role.SUPER_ADMIN].some((role) => role === actor.role))
      throw new ForbiddenException('Collection holds require an administrator.');
  }
}
function isCollectionEmailEvent(value: string | null): value is OverdueEmailEvent {
  return (
    value !== null &&
    [
      'FIRST_REMINDER',
      'SECOND_REMINDER',
      'FINAL_WARNING',
      'RECOVERY_FINAL_WARNING',
      'MANUAL_REMINDER',
      'GRACE_PERIOD_EXTENDED',
      'SERVICE_SUSPENDED',
      'SERVICE_RESTORED',
      'SERVICE_RESTORATION_REQUESTED',
    ].includes(value)
  );
}
