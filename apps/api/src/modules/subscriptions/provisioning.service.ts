import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CollectionStage,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
  ServiceProvisioningAction,
  ServiceProvisioningStatus,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import {
  payableCents,
  suspensionDate,
  finalWarningAllowsSuspension,
  collectionExtension,
} from './collection-deadline';
import { hasActiveCollectionHold } from './collection-hold.policy';
import { CollectionPolicyService } from './collection-policy.service';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);
  private readonly mockResult: 'SUCCESS' | 'PENDING' | 'FAILED';
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly policy?: CollectionPolicyService,
  ) {
    this.mockResult = config.getOrThrow('overdueLifecycle').provisioningMockResult;
  }
  suspendService(subscriptionId: string, transitionAt: Date): Promise<void> {
    return this.request(
      subscriptionId,
      ServiceProvisioningAction.SUSPEND,
      `non-payment-suspend:${subscriptionId}:${transitionAt.toISOString()}`,
    );
  }
  restoreService(subscriptionId: string, transitionAt: Date): Promise<void> {
    return this.request(
      subscriptionId,
      ServiceProvisioningAction.RESTORE,
      `payment-restore:${subscriptionId}:${transitionAt.toISOString()}`,
    );
  }
  async reconcilePending(limit: number): Promise<number> {
    const requests = await this.prisma.serviceProvisioningRequest.findMany({
      where: {
        OR: [
          {
            status: { in: [ServiceProvisioningStatus.PENDING, ServiceProvisioningStatus.FAILED] },
            failureReason: { not: 'COLLECTION_NO_LONGER_APPLICABLE' },
          },
          { status: ServiceProvisioningStatus.PENDING, failureReason: null },
          {
            status: ServiceProvisioningStatus.COMPLETED,
            notificationDeliveredAt: null,
            collectionInvoiceId: null,
          },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const request of requests) await this.process(request.id);
    return requests.length;
  }
  private async request(
    subscriptionId: string,
    action: ServiceProvisioningAction,
    idempotencyKey: string,
  ): Promise<void> {
    const request = await this.prisma.serviceProvisioningRequest.upsert({
      where: { idempotencyKey },
      create: { subscriptionId, action, idempotencyKey },
      update: {},
    });
    await this.process(request.id);
  }
  private async process(requestId: string): Promise<void> {
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ServiceProvisioningRequest" WHERE "id" = CAST(${requestId} AS uuid) FOR UPDATE`;
        const request = await tx.serviceProvisioningRequest.findUnique({
          where: { id: requestId },
        });
        if (!request) return null;
        await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = CAST(${request.subscriptionId} AS uuid) FOR UPDATE`;
        const sub = await tx.subscription.findUniqueOrThrow({
          where: { id: request.subscriptionId },
          include: { customer: true },
        });
        if (request.status === ServiceProvisioningStatus.COMPLETED)
          return request.notificationDeliveredAt || request.collectionInvoiceId
            ? null
            : { request, sub, completed: true };
        if (request.collectionInvoiceId) {
          let valid = false;
          const invoices = await tx.invoice.findMany({
            where: {
              subscriptionId: sub.id,
              status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
              dueDate: { lte: now },
            },
            include: { payments: true },
          });
          const balance = invoices.reduce((sum, i) => sum + payableCents(i), 0);
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
          if (request.action === ServiceProvisioningAction.SUSPEND) {
            const invoice = invoices.find((i) => i.id === request.collectionInvoiceId);
            const pending = await tx.payment.count({
              where: {
                invoice: {
                  subscriptionId: sub.id,
                  status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
                },
                status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
              },
            });
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
            const policy = await this.policy!.get(tx);
            valid =
              !!invoice &&
              finalWarningAllowsSuspension(
                invoice,
                suspensionDate(
                  invoice,
                  collectionExtension(sub.graceExtendedUntil, invoices),
                  policy,
                  this.policy!.dayMilliseconds,
                ),
                now,
              ) &&
              [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE].some(
                (status) => status === sub.status,
              ) &&
              !hasActiveCollectionHold(sub, now) &&
              !pending &&
              !unsettledCredits &&
              !invoices.some(
                (i) => i.stripeNextPaymentAttempt && i.stripeNextPaymentAttempt > now,
              ) &&
              !relocation &&
              !cancellation;
          } else {
            valid =
              balance === 0 &&
              sub.status === SubscriptionStatus.SUSPENDED &&
              sub.suspensionReason === SuspensionReason.NON_PAYMENT &&
              !relocation &&
              !cancellation;
          }
          if (!valid) {
            if (
              request.action === ServiceProvisioningAction.RESTORE &&
              balance === 0 &&
              (relocation || cancellation) &&
              sub.status === SubscriptionStatus.SUSPENDED &&
              sub.suspensionReason === SuspensionReason.NON_PAYMENT
            ) {
              await tx.auditLog.upsert({
                where: { deduplicationKey: `${request.id}-workflow-review` },
                create: {
                  deduplicationKey: `${request.id}-workflow-review`,
                  action: 'COLLECTION_REVIEW_REQUIRED',
                  entityType: 'Invoice',
                  entityId: request.collectionInvoiceId,
                  notificationEvent: 'COLLECTION_REVIEW_REQUIRED',
                  metadata: {
                    subscriptionId: sub.id,
                    reason: 'RESTORATION_BLOCKED_BY_ACTIVE_WORKFLOW',
                  },
                },
                update: {},
              });
            }
            await tx.serviceProvisioningRequest.update({
              where: { id: request.id },
              data: {
                status: ServiceProvisioningStatus.FAILED,
                failureReason: 'COLLECTION_NO_LONGER_APPLICABLE',
                notificationDeliveredAt: now,
              },
            });
            await tx.subscription.update({
              where: { id: sub.id },
              data: { provisioningStatus: null },
            });
            return null;
          }
        } else if (
          [
            SubscriptionStatus.CANCELLED,
            SubscriptionStatus.TERMINATED,
            SubscriptionStatus.CANCELLATION_PENDING,
            SubscriptionStatus.DISCONNECTION_PENDING,
          ].some((status) => status === sub.status) ||
          (request.action === ServiceProvisioningAction.SUSPEND &&
            sub.status !== SubscriptionStatus.SUSPENDED) ||
          (request.action === ServiceProvisioningAction.RESTORE &&
            sub.status !== SubscriptionStatus.ACTIVE)
        ) {
          await tx.serviceProvisioningRequest.update({
            where: { id: request.id },
            data: {
              status: ServiceProvisioningStatus.COMPLETED,
              completedAt: now,
              failureReason: 'SUPERSEDED',
              notificationDeliveredAt: now,
            },
          });
          return null;
        }
        if (this.mockResult === 'PENDING') {
          await tx.serviceProvisioningRequest.update({
            where: { id: request.id },
            data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
          });
          return null;
        }
        const completed = this.mockResult === 'SUCCESS';
        const status = completed
          ? ServiceProvisioningStatus.COMPLETED
          : ServiceProvisioningStatus.FAILED;
        await tx.serviceProvisioningRequest.update({
          where: { id: request.id },
          data: {
            status,
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
            completedAt: completed ? now : null,
            failureReason: completed ? null : 'MOCK_PROVIDER_FAILURE',
          },
        });
        const suspend = request.action === ServiceProvisioningAction.SUSPEND;
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            provisioningStatus: status,
            provisioningFailure: completed ? null : 'MOCK_PROVIDER_FAILURE',
            ...(completed && request.collectionInvoiceId
              ? suspend
                ? {
                    status: SubscriptionStatus.SUSPENDED,
                    suspendedAt: now,
                    suspensionReason: SuspensionReason.NON_PAYMENT,
                  }
                : {
                    status: SubscriptionStatus.ACTIVE,
                    reactivatedAt: now,
                    suspensionReason: null,
                    gracePeriodEndsAt: null,
                    graceExtendedUntil: null,
                    pastDueAt: null,
                    eligibleForTerminationAt: null,
                  }
              : {}),
          },
        });
        if (completed && request.collectionInvoiceId) {
          await tx.invoice.update({
            where: { id: request.collectionInvoiceId },
            data: {
              collectionStage: suspend ? CollectionStage.SUSPENDED : CollectionStage.RESOLVED,
            },
          });
          await tx.auditLog.upsert({
            where: { deduplicationKey: `${request.id}-success` },
            create: {
              action: suspend ? 'SERVICE_SUSPENDED_OVERDUE' : 'SERVICE_RESTORED_AFTER_PAYMENT',
              entityType: 'Invoice',
              entityId: request.collectionInvoiceId,
              deduplicationKey: `${request.id}-success`,
              notificationEvent: suspend ? 'SERVICE_SUSPENDED' : 'SERVICE_RESTORED',
              metadata: { subscriptionId: sub.id, provisioningRequestId: request.id },
            },
            update: {},
          });
        } else {
          await tx.auditLog.upsert({
            where: { deduplicationKey: `${request.id}-${completed ? 'success' : 'failure'}` },
            create: {
              action: completed
                ? suspend
                  ? 'SERVICE_SUSPENSION_PROVISIONED'
                  : 'SERVICE_RESTORED'
                : suspend
                  ? 'AUTOMATIC_SUSPENSION_FAILED'
                  : 'AUTOMATIC_RESTORATION_FAILED',
              entityType: 'Subscription',
              entityId: sub.id,
              deduplicationKey: `${request.id}-${completed ? 'success' : 'failure'}`,
              metadata: {
                action: request.action,
                provider: 'MOCK',
                provisioningRequestId: request.id,
              },
            },
            update: {},
          });
        }
        return { request, sub, completed };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!result || (result.completed && result.request.collectionInvoiceId)) return;
    try {
      await this.notifications?.sendProvisioningResult({
        subscriptionId: result.sub.id,
        provisioningRequestId: result.request.id,
        userId: result.sub.customer.userId,
        action: result.request.action,
        succeeded: result.completed,
      });
      await this.prisma.serviceProvisioningRequest.update({
        where: { id: result.request.id },
        data: { notificationDeliveredAt: now },
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'service_provisioning_notification_failed',
          requestId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
