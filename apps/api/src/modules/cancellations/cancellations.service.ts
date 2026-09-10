import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  CancellationStatus,
  CancellationType,
  InvoiceStatus,
  MockDisconnectionScenario,
  PlanChangeStatus,
  Prisma,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import { buildPaginationMeta, dateRange } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { NotificationService } from '../notifications/notification.service';
import { CancellationWorkflowPolicyService } from './cancellation-workflow-policy.service';
import type { CancellationQueryDto, CreateCancellationDto } from './dto/cancellation.dto';
import { WholesaleDisconnectionProvider } from './providers/wholesale-disconnection.provider';

const activePlanChangeStatuses: PlanChangeStatus[] = [
  PlanChangeStatus.PENDING,
  PlanChangeStatus.CHECKOUT_CREATED,
  PlanChangeStatus.PROCESSING,
  PlanChangeStatus.SCHEDULED,
];

const openCancellationStatuses: CancellationStatus[] = [
  CancellationStatus.REQUESTED,
  CancellationStatus.SCHEDULED,
  CancellationStatus.PROCESSING,
  CancellationStatus.DISCONNECTION_PENDING,
  CancellationStatus.FAILED,
];

const cancellationInclude = {
  customer: {
    select: {
      id: true,
      userId: true,
      customerNumber: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  subscription: { include: { plan: true } },
  requestedBy: { select: { id: true, displayName: true, email: true } },
  revokedBy: { select: { id: true, displayName: true, email: true } },
  notes: {
    include: { author: { select: { id: true, displayName: true, email: true } } },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.CancellationRequestInclude;

type CancellationRecord = Prisma.CancellationRequestGetPayload<{
  include: typeof cancellationInclude;
}>;

interface ClaimedCancellation {
  request: CancellationRecord;
  version: number;
  firstSubmission: boolean;
  scenario: MockDisconnectionScenario;
}

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);
  private readonly batchSize: number;
  private readonly configuredScenario: MockDisconnectionScenario;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: CancellationWorkflowPolicyService,
    private readonly provider: WholesaleDisconnectionProvider,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const config = configService.getOrThrow('cancellation');
    this.batchSize = config.batchSize;
    this.configuredScenario = config.mockScenario as MockDisconnectionScenario;
  }

  async preview(subscriptionId: string, type: CancellationType, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { customer: { select: { userId: true } }, plan: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    this.workflow.assertCanRequest(subscription, actor);
    const outstanding = await this.outstandingBalance(subscription.customerId);
    return {
      subscriptionId: subscription.id,
      type,
      currentPlan: subscription.plan,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingAt: subscription.currentPeriodEnd,
      proposedServiceEndAt:
        type === CancellationType.END_OF_PERIOD ? subscription.currentPeriodEnd : new Date(),
      outstandingBalanceCents: outstanding,
      currency: 'AUD',
      automaticRefundCents: null,
      billingMessage:
        type === CancellationType.END_OF_PERIOD
          ? 'Your current billing period remains available until the scheduled service end. No new billing period will be opened after that date.'
          : 'No refund is issued automatically. Any credit or refund must be reviewed through the existing billing and refund workflow.',
      providerSimulation: this.provider.simulated,
    };
  }

  async create(subscriptionId: string, input: CreateCancellationDto, actor: AuthenticatedUser) {
    const requestedAt = new Date();
    let created: { request: CancellationRecord; reused: boolean };
    try {
      created = await this.prisma.$transaction(
        async (transaction) => {
          await this.lockSubscription(transaction, subscriptionId);
          const subscription = await transaction.subscription.findUnique({
            where: { id: subscriptionId },
            include: { customer: { select: { userId: true } }, plan: true },
          });
          if (!subscription) throw new NotFoundException('Subscription not found.');
          this.workflow.assertCanRequestActor(subscription, actor);
          const existing = await transaction.cancellationRequest.findFirst({
            where: { subscriptionId, status: { in: openCancellationStatuses } },
            include: cancellationInclude,
          });
          if (existing) {
            if (
              existing.type === input.type &&
              existing.reason === input.reason &&
              existing.reasonDetails === (input.reasonDetails ?? null) &&
              existing.requestedByUserId === actor.id
            ) {
              return { request: existing, reused: true };
            }
            throw new ConflictException(
              `Cancellation ${existing.requestNumber} is already open for this service.`,
            );
          }
          this.workflow.assertCanRequest(subscription, actor);
          if (
            subscription.status === SubscriptionStatus.PENDING &&
            input.type !== CancellationType.IMMEDIATE
          ) {
            throw new ConflictException(
              'A pending activation can only be withdrawn as soon as possible.',
            );
          }
          const activePlanChange = await transaction.planChangeRequest.findFirst({
            where: {
              sourceSubscriptionId: subscriptionId,
              status: { in: activePlanChangeStatuses },
            },
            select: { id: true, status: true },
          });
          if (activePlanChange) {
            throw new ConflictException(
              'A plan change is already in progress. Cancel or complete it before cancelling the service.',
            );
          }
          const effectiveAt =
            input.type === CancellationType.END_OF_PERIOD
              ? subscription.currentPeriodEnd
              : requestedAt;
          if (input.type === CancellationType.END_OF_PERIOD && effectiveAt <= requestedAt) {
            throw new ConflictException(
              'The current billing period has ended. Refresh the service before scheduling cancellation.',
            );
          }
          const requestNumber = await this.nextRequestNumber(transaction, requestedAt);
          const status =
            input.type === CancellationType.END_OF_PERIOD
              ? CancellationStatus.SCHEDULED
              : CancellationStatus.REQUESTED;
          const providerOperation =
            subscription.status === SubscriptionStatus.PENDING
              ? CancellationProviderOperation.WITHDRAW_ACTIVATION
              : CancellationProviderOperation.DISCONNECT_SERVICE;
          const request = await transaction.cancellationRequest.create({
            data: {
              requestNumber,
              subscriptionId,
              customerId: subscription.customerId,
              type: input.type,
              reason: input.reason,
              reasonDetails: input.reasonDetails,
              requestedAt,
              requestedByUserId: actor.id,
              requestedByRole: actor.role,
              effectiveAt,
              status,
              providerOperation,
              subscriptionStatusBefore: subscription.status,
              providerName: this.provider.name,
              providerIdempotencyKey: `cancellation:${requestNumber}`,
              providerScenario: this.configuredScenario,
            },
            include: cancellationInclude,
          });
          const subscriptionUpdate = await transaction.subscription.updateMany({
            where: { id: subscription.id, status: subscription.status },
            data: { status: SubscriptionStatus.CANCELLATION_PENDING },
          });
          if (subscriptionUpdate.count !== 1) {
            throw new ConflictException(
              'The subscription changed while cancellation was requested.',
            );
          }
          await this.audit(transaction, request, actor, 'CANCELLATION_REQUESTED', {
            oldStatus: subscription.status,
            newStatus: SubscriptionStatus.CANCELLATION_PENDING,
          });
          if (status === CancellationStatus.SCHEDULED) {
            await this.audit(transaction, request, actor, 'CANCELLATION_SCHEDULED');
          }
          return { request, reused: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.cancellationRequest.findFirst({
          where: { subscriptionId, status: { in: openCancellationStatuses } },
          include: cancellationInclude,
        });
        if (existing) return this.customerResponse(existing, true);
        throw new ConflictException('A cancellation is already open for this service.');
      }
      throw error;
    }

    if (created.reused) return this.customerResponse(created.request, true);
    await this.notifyCustomer('REQUESTED', created.request);
    if (created.request.status === CancellationStatus.SCHEDULED) {
      await this.notifyCustomer('SCHEDULED', created.request);
    }
    await this.dashboardCache.invalidate();

    if (created.request.status === CancellationStatus.REQUESTED) {
      await this.process(created.request.id);
      const refreshed = await this.load(created.request.id);
      return this.customerResponse(refreshed, false);
    }
    return this.customerResponse(created.request, false);
  }

  async findForCustomer(subscriptionId: string, actor: AuthenticatedUser) {
    const request = await this.prisma.cancellationRequest.findFirst({
      where: { subscriptionId, customer: { userId: actor.id } },
      include: cancellationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!request) return null;
    return this.customerResponse(request);
  }

  async revoke(subscriptionId: string, actor: AuthenticatedUser) {
    const revokedAt = new Date();
    const request = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockSubscription(transaction, subscriptionId);
        const existing = await transaction.cancellationRequest.findFirst({
          where: { subscriptionId, status: { in: openCancellationStatuses } },
          include: cancellationInclude,
        });
        if (!existing) throw new NotFoundException('Open cancellation request not found.');
        this.workflow.assertCanRevoke(existing, actor);
        const changed = await transaction.cancellationRequest.updateMany({
          where: {
            id: existing.id,
            version: existing.version,
            status: CancellationStatus.SCHEDULED,
            providerStatus: CancellationProviderStatus.NOT_SUBMITTED,
          },
          data: {
            status: CancellationStatus.REVOKED,
            revokedAt,
            revokedByUserId: actor.id,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException(
            'This cancellation started processing before it could be revoked.',
          );
        }
        const restored = await transaction.subscription.updateMany({
          where: { id: subscriptionId, status: SubscriptionStatus.CANCELLATION_PENDING },
          data: { status: existing.subscriptionStatusBefore },
        });
        if (restored.count !== 1) {
          throw new ConflictException(
            'The service state changed before this cancellation could be revoked.',
          );
        }
        await this.audit(transaction, existing, actor, 'CANCELLATION_REVOKED', {
          oldStatus: CancellationStatus.SCHEDULED,
          newStatus: CancellationStatus.REVOKED,
        });
        return transaction.cancellationRequest.findUniqueOrThrow({
          where: { id: existing.id },
          include: cancellationInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.notifyCustomer('REVOKED', request);
    await this.dashboardCache.invalidate();
    return this.customerResponse(request);
  }

  async revokeForOperations(requestNumber: string, actor: AuthenticatedUser) {
    const request = await this.prisma.cancellationRequest.findUnique({
      where: { requestNumber },
      select: { subscriptionId: true },
    });
    if (!request) throw new NotFoundException('Cancellation request not found.');
    await this.revoke(request.subscriptionId, actor);
    return this.findOne(requestNumber, actor);
  }

  async list(query: CancellationQueryDto, actor: AuthenticatedUser) {
    const requestedAt = dateRange(query.dateFrom, query.dateTo);
    const where: Prisma.CancellationRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(requestedAt ? { requestedAt } : {}),
    };
    const search = query.search?.trim();
    if (search) {
      const searchConditions: Prisma.CancellationRequestWhereInput[] = [
        { requestNumber: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        { customer: { email: { contains: search, mode: 'insensitive' } } },
        { customer: { customerNumber: { contains: search, mode: 'insensitive' } } },
      ];
      if (this.isUuid(search)) searchConditions.push({ subscriptionId: search });
      where.OR = searchConditions;
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.cancellationRequest.findMany({
        where,
        include: cancellationInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.cancellationRequest.count({ where }),
    ]);
    return {
      data: data.map((request) => this.staffResponse(request, actor)),
      meta: buildPaginationMeta(query, total),
    };
  }

  async summary() {
    const [total, open, failed, immediate, endOfPeriod] = await this.prisma.$transaction([
      this.prisma.cancellationRequest.count(),
      this.prisma.cancellationRequest.count({
        where: { status: { in: openCancellationStatuses } },
      }),
      this.prisma.cancellationRequest.count({ where: { status: CancellationStatus.FAILED } }),
      this.prisma.cancellationRequest.count({ where: { type: CancellationType.IMMEDIATE } }),
      this.prisma.cancellationRequest.count({ where: { type: CancellationType.END_OF_PERIOD } }),
    ]);
    return {
      total,
      open,
      failed,
      immediate,
      endOfPeriod,
      providerSimulated: this.provider.simulated,
    };
  }

  async findOne(requestNumber: string, actor: AuthenticatedUser) {
    const request = await this.prisma.cancellationRequest.findUnique({
      where: { requestNumber },
      include: cancellationInclude,
    });
    if (!request) throw new NotFoundException('Cancellation request not found.');
    const timeline = await this.prisma.auditLog.findMany({
      where: { entityType: 'CancellationRequest', entityId: request.id },
      include: { actor: { select: { displayName: true, email: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { ...this.staffResponse(request, actor), timeline };
  }

  async addNote(requestNumber: string, body: string, actor: AuthenticatedUser) {
    const request = await this.prisma.cancellationRequest.findUnique({
      where: { requestNumber },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('Cancellation request not found.');
    const note = await this.prisma.cancellationNote.create({
      data: {
        cancellationRequestId: request.id,
        authorUserId: actor.id,
        authorRole: actor.role,
        body,
      },
      include: { author: { select: { id: true, displayName: true, email: true } } },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'CANCELLATION_NOTE_ADDED',
        entityType: 'CancellationRequest',
        entityId: request.id,
        metadata: { noteId: note.id },
      },
    });
    return note;
  }

  async retry(
    requestNumber: string,
    actor: AuthenticatedUser,
    mockScenario?: MockDisconnectionScenario,
  ) {
    const request = await this.prisma.cancellationRequest.findUnique({
      where: { requestNumber },
      include: cancellationInclude,
    });
    if (!request) throw new NotFoundException('Cancellation request not found.');
    this.workflow.assertCanRetry(request, actor);
    if (mockScenario && !this.provider.simulated) {
      throw new ConflictException('Provider scenarios are only available with the mock provider.');
    }
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'CANCELLATION_RETRIED',
        entityType: 'CancellationRequest',
        entityId: request.id,
        metadata: { attemptCount: request.attemptCount + 1 },
      },
    });
    await this.process(request.id, true, mockScenario);
    return this.findOne(requestNumber, actor);
  }

  async reconcileDue(now = new Date(), limit = this.batchSize): Promise<{ processed: number }> {
    const candidates = await this.prisma.cancellationRequest.findMany({
      where: {
        OR: [
          { status: CancellationStatus.SCHEDULED, effectiveAt: { lte: now } },
          {
            status: {
              in: [CancellationStatus.PROCESSING, CancellationStatus.DISCONNECTION_PENDING],
            },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    let processed = 0;
    for (const candidate of candidates) {
      try {
        if (await this.process(candidate.id, false, undefined, now)) processed += 1;
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            event: 'cancellation_reconciliation_failed',
            cancellationRequestId: candidate.id,
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      }
    }
    if (processed) await this.dashboardCache.invalidate();
    return { processed };
  }

  async process(
    id: string,
    allowFailed = false,
    scenarioOverride?: MockDisconnectionScenario,
    now = new Date(),
  ): Promise<boolean> {
    const claimed = await this.claim(id, allowFailed, scenarioOverride, now);
    if (!claimed) return false;
    let result;
    try {
      result = claimed.request.providerDisconnectionId
        ? await this.provider.getDisconnectionStatus({
            providerReference: claimed.request.providerDisconnectionId,
            operation: claimed.request.providerOperation,
            scenario: claimed.scenario,
            pollCount: this.providerPollCount(claimed.request.providerPayload),
          })
        : await this.provider.requestDisconnection({
            requestNumber: claimed.request.requestNumber,
            subscriptionId: claimed.request.subscriptionId,
            customerId: claimed.request.customerId,
            effectiveAt: claimed.request.effectiveAt,
            operation: claimed.request.providerOperation,
            idempotencyKey: claimed.request.providerIdempotencyKey,
            scenario: claimed.scenario,
          });
    } catch {
      result = {
        providerReference: claimed.request.providerDisconnectionId ?? '',
        status: CancellationProviderStatus.FAILED,
        payload: { providerError: true },
        failureReason: 'The wholesale provider operation could not be completed.',
      };
    }

    const applied = await this.applyProviderResult(claimed, result, now);
    if (applied?.status === CancellationStatus.COMPLETED) {
      await this.notifyCustomer('COMPLETED', applied);
    } else if (applied?.status === CancellationStatus.FAILED) {
      await this.notifyFailure(applied);
    }
    return Boolean(applied);
  }

  private async claim(
    id: string,
    allowFailed: boolean,
    scenarioOverride: MockDisconnectionScenario | undefined,
    now: Date,
  ): Promise<ClaimedCancellation | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const initial = await transaction.cancellationRequest.findUnique({
          where: { id },
          select: { subscriptionId: true },
        });
        if (!initial) return null;
        await this.lockSubscription(transaction, initial.subscriptionId);
        const request = await transaction.cancellationRequest.findUnique({
          where: { id },
          include: cancellationInclude,
        });
        if (!request) return null;
        if (request.status === CancellationStatus.SCHEDULED && request.effectiveAt > now)
          return null;
        const eligible: CancellationStatus[] = [
          CancellationStatus.REQUESTED,
          CancellationStatus.SCHEDULED,
          CancellationStatus.PROCESSING,
          CancellationStatus.DISCONNECTION_PENDING,
          ...(allowFailed ? [CancellationStatus.FAILED] : []),
        ];
        if (!eligible.includes(request.status)) return null;
        const scenario = scenarioOverride ?? request.providerScenario ?? this.configuredScenario;
        const changed = await transaction.cancellationRequest.updateMany({
          where: { id, version: request.version, status: request.status },
          data: {
            status: CancellationStatus.PROCESSING,
            processingStartedAt: request.processingStartedAt ?? now,
            failedReason: null,
            providerScenario: scenario,
            attemptCount: { increment: 1 },
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) return null;
        return {
          request,
          version: request.version + 1,
          firstSubmission: !request.providerDisconnectionId,
          scenario,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applyProviderResult(
    claimed: ClaimedCancellation,
    result: {
      providerReference: string;
      status: CancellationProviderStatus;
      payload: Record<string, string | number | boolean | null>;
      failureReason?: string;
    },
    now: Date,
  ): Promise<CancellationRecord | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        await this.lockSubscription(transaction, claimed.request.subscriptionId);
        const current = await transaction.cancellationRequest.findUnique({
          where: { id: claimed.request.id },
        });
        if (
          !current ||
          current.version !== claimed.version ||
          current.status !== CancellationStatus.PROCESSING
        )
          return null;

        const operationName =
          claimed.request.providerOperation === CancellationProviderOperation.WITHDRAW_ACTIVATION
            ? 'ACTIVATION_WITHDRAWAL'
            : 'DISCONNECTION';

        if (claimed.firstSubmission && result.providerReference) {
          await this.audit(transaction, claimed.request, undefined, `${operationName}_SUBMITTED`, {
            providerReference: result.providerReference || null,
            simulated: this.provider.simulated,
            providerOperation: claimed.request.providerOperation,
          });
        }

        if (result.status === CancellationProviderStatus.COMPLETED) {
          await transaction.cancellationRequest.update({
            where: { id: current.id },
            data: {
              status: CancellationStatus.COMPLETED,
              providerDisconnectionId: result.providerReference || current.providerDisconnectionId,
              providerStatus: result.status,
              providerPayload: result.payload,
              providerLastCheckedAt: now,
              completedAt: now,
              failedReason: null,
              version: { increment: 1 },
            },
          });
          const ended = await transaction.subscription.updateMany({
            where: {
              id: current.subscriptionId,
              status: {
                in: [
                  SubscriptionStatus.CANCELLATION_PENDING,
                  SubscriptionStatus.DISCONNECTION_PENDING,
                ],
              },
            },
            data: {
              status: SubscriptionStatus.CANCELLED,
              endDate: this.utcDate(now),
              endReason: 'CUSTOMER_CANCELLATION',
            },
          });
          if (ended.count !== 1) {
            throw new ConflictException('The service state changed before cancellation completed.');
          }
          await this.audit(transaction, claimed.request, undefined, `${operationName}_CONFIRMED`, {
            providerReference: result.providerReference || null,
            simulated: this.provider.simulated,
          });
          await this.audit(transaction, claimed.request, undefined, 'CANCELLATION_COMPLETED', {
            oldStatus: current.status,
            newStatus: CancellationStatus.COMPLETED,
          });
        } else if (
          result.status === CancellationProviderStatus.FAILED ||
          result.status === CancellationProviderStatus.MANUAL_REVIEW_REQUIRED
        ) {
          await transaction.cancellationRequest.update({
            where: { id: current.id },
            data: {
              status: CancellationStatus.FAILED,
              providerDisconnectionId: result.providerReference || current.providerDisconnectionId,
              providerStatus: result.status,
              providerPayload: result.payload,
              providerLastCheckedAt: now,
              failedReason:
                result.failureReason ?? 'The wholesale provider operation requires review.',
              version: { increment: 1 },
            },
          });
          await transaction.subscription.updateMany({
            where: {
              id: current.subscriptionId,
              status: {
                in: [
                  SubscriptionStatus.CANCELLATION_PENDING,
                  SubscriptionStatus.DISCONNECTION_PENDING,
                ],
              },
            },
            data: { status: current.subscriptionStatusBefore },
          });
          await this.audit(transaction, claimed.request, undefined, `${operationName}_FAILED`, {
            providerReference: result.providerReference || null,
            providerStatus: result.status,
          });
        } else {
          await transaction.cancellationRequest.update({
            where: { id: current.id },
            data: {
              status: CancellationStatus.DISCONNECTION_PENDING,
              providerDisconnectionId: result.providerReference || current.providerDisconnectionId,
              providerStatus: result.status,
              providerPayload: result.payload,
              providerLastCheckedAt: now,
              version: { increment: 1 },
            },
          });
          await transaction.subscription.updateMany({
            where: { id: current.subscriptionId, status: SubscriptionStatus.CANCELLATION_PENDING },
            data: { status: SubscriptionStatus.DISCONNECTION_PENDING },
          });
        }
        return transaction.cancellationRequest.findUniqueOrThrow({
          where: { id: current.id },
          include: cancellationInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async outstandingBalance(customerId: string): Promise<number> {
    const aggregate = await this.prisma.invoice.aggregate({
      where: { customerId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] } },
      _sum: { totalCents: true },
    });
    return aggregate._sum.totalCents ?? 0;
  }

  private async nextRequestNumber(
    transaction: Prisma.TransactionClient,
    at: Date,
  ): Promise<string> {
    const year = at.getUTCFullYear();
    const sequence = await transaction.cancellationRequestSequence.upsert({
      where: { year },
      create: { year, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `CAN-${year}-${String(sequence.value).padStart(5, '0')}`;
  }

  private audit(
    transaction: Prisma.TransactionClient,
    request: Pick<CancellationRecord, 'id' | 'subscriptionId' | 'customerId' | 'requestNumber'>,
    actor: AuthenticatedUser | undefined,
    action: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    return transaction.auditLog.create({
      data: {
        actorUserId: actor?.id,
        action,
        entityType: 'CancellationRequest',
        entityId: request.id,
        metadata: {
          requestNumber: request.requestNumber,
          subscriptionId: request.subscriptionId,
          customerId: request.customerId,
          actorRole: actor?.role ?? 'SYSTEM',
          ...metadata,
        },
      },
    });
  }

  private async notifyCustomer(
    event: 'REQUESTED' | 'SCHEDULED' | 'REVOKED' | 'COMPLETED',
    request: CancellationRecord,
  ): Promise<void> {
    try {
      await this.notifications.sendCancellationNotification({
        event,
        requestNumber: request.requestNumber,
        customerName: `${request.customer.firstName} ${request.customer.lastName}`,
        customerEmail: request.customer.email,
        planName: request.subscription.plan.name,
        effectiveAt: request.effectiveAt,
        providerOperation: request.providerOperation,
        providerSimulated: this.provider.simulated,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'cancellation_notification_enqueue_failed',
          cancellationRequestId: request.id,
          notification: event,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private async notifyFailure(request: CancellationRecord): Promise<void> {
    try {
      await this.notifications.sendCancellationOperationalAlert({
        requestNumber: request.requestNumber,
        customerName: `${request.customer.firstName} ${request.customer.lastName}`,
        planName: request.subscription.plan.name,
        reason: request.failedReason ?? 'Wholesale provider operation requires review.',
        providerSimulated: this.provider.simulated,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'cancellation_failure_alert_enqueue_failed',
          cancellationRequestId: request.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private customerResponse(request: CancellationRecord, reused = false) {
    return {
      id: request.id,
      requestNumber: request.requestNumber,
      subscriptionId: request.subscriptionId,
      type: request.type,
      reason: request.reason,
      reasonDetails: request.reasonDetails,
      requestedAt: request.requestedAt,
      effectiveAt: request.effectiveAt,
      status: request.status,
      completedAt: request.completedAt,
      revokedAt: request.revokedAt,
      plan: request.subscription.plan,
      canRevoke:
        request.status === CancellationStatus.SCHEDULED &&
        request.providerStatus === CancellationProviderStatus.NOT_SUBMITTED,
      statusMessage: this.customerStatusMessage(request),
      reused,
    };
  }

  private staffResponse(request: CancellationRecord, actor: AuthenticatedUser) {
    return {
      ...request,
      provider: {
        name: request.providerName,
        reference: request.providerDisconnectionId,
        status: request.providerStatus,
        simulated: this.provider.simulated,
        lastCheckedAt: request.providerLastCheckedAt,
        failureReason: request.failedReason,
      },
      capabilities: {
        canRetry:
          (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) &&
          request.status === CancellationStatus.FAILED,
        canRevoke:
          (actor.role === Role.ADMIN || actor.role === Role.SUPER_ADMIN) &&
          request.status === CancellationStatus.SCHEDULED &&
          request.providerStatus === CancellationProviderStatus.NOT_SUBMITTED,
        canEscalate: actor.role === Role.STAFF && request.status === CancellationStatus.FAILED,
      },
    };
  }

  private customerStatusMessage(request: CancellationRecord): string {
    if (request.status === CancellationStatus.SCHEDULED) {
      return `Your service is scheduled to end on ${this.formatDate(request.effectiveAt)}.`;
    }
    if (request.status === CancellationStatus.COMPLETED) {
      return this.provider.simulated
        ? `The internal cancellation simulation completed on ${this.formatDate(request.completedAt ?? request.effectiveAt)}. This is not confirmation of a real NBN or wholesale disconnection.`
        : `Your internet service ended on ${this.formatDate(request.completedAt ?? request.effectiveAt)}.`;
    }
    if (request.status === CancellationStatus.REVOKED) {
      return 'Your scheduled cancellation was revoked and your service will continue.';
    }
    if (request.status === CancellationStatus.FAILED) {
      return 'We could not complete the service cancellation automatically. Mero Telecom support has been notified.';
    }
    return 'Your cancellation is in progress. We will update you when processing is complete.';
  }

  private formatDate(value: Date): string {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Adelaide',
    }).format(value);
  }

  private providerPollCount(value: Prisma.JsonValue | null): number {
    if (!value || Array.isArray(value) || typeof value !== 'object') return 0;
    const count = value.pollCount;
    return typeof count === 'number' && Number.isSafeInteger(count) ? count : 0;
  }

  private load(id: string): Promise<CancellationRecord> {
    return this.prisma.cancellationRequest.findUniqueOrThrow({
      where: { id },
      include: cancellationInclude,
    });
  }

  private lockSubscription(transaction: Prisma.TransactionClient, subscriptionId: string) {
    return transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subscriptionId}))`;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private utcDate(value: Date): Date {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
}
