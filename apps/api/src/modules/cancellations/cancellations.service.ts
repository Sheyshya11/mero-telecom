import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  CancellationStatus,
  CancellationType,
  InvoiceType,
  InvoiceStatus,
  MockDisconnectionScenario,
  PlanChangeStatus,
  Prisma,
  Role,
  ServiceProvisioningStatus,
  ServiceRelocationStatus,
  SubscriptionStatus,
  SuspensionReason,
  BillingMode,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

import { buildPaginationMeta, dateRange } from '../../common/pagination';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { NotificationService } from '../notifications/notification.service';
import { ProvisioningService } from '../subscriptions/provisioning.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { BillingService } from '../billing/billing.service';
import { RefundsService } from '../refunds/refunds.service';
import { assertSubscriptionTransition } from '../subscriptions/subscription-lifecycle.policy';
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
  refund: {
    select: {
      id: true,
      status: true,
      originalAmountCents: true,
      refundAmountCents: true,
      currency: true,
      stripeRefundId: true,
      requestedAt: true,
      processedAt: true,
      failedAt: true,
      failureReason: true,
      payment: {
        select: {
          id: true,
          amountCents: true,
          refundedCents: true,
          status: true,
          providerPaymentId: true,
        },
      },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          billingPeriodStart: true,
          billingPeriodEnd: true,
        },
      },
    },
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

interface CancellationRefundQuote {
  amountPaidCents: number;
  eligibleRecurringAmountCents: number;
  calculatedProrationCents: number;
  previousSuccessfulRefundCents: number;
  reservedRefundCents: number;
  remainingRefundableCents: number;
  refundAmountCents: number;
  paymentId: string | null;
  invoiceId: string | null;
  noRefundReason: string | null;
  periodDurationMilliseconds: number;
  remainingDurationMilliseconds: number;
}

@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);
  private readonly batchSize: number;
  private readonly configuredScenario: MockDisconnectionScenario;
  private readonly gracePeriodDays: number;
  private readonly terminationDays: number;
  private readonly stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: CancellationWorkflowPolicyService,
    private readonly provider: WholesaleDisconnectionProvider,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
    private readonly provisioning: ProvisioningService,
    private readonly billing: BillingService,
    private readonly refunds: RefundsService,
    configService: ConfigService<AppConfig, true>,
    stripeClient?: StripeClientService,
  ) {
    this.stripe = stripeClient?.client;
    const config = configService.getOrThrow('cancellation');
    const overdueLifecycle = configService.getOrThrow('overdueLifecycle');
    this.batchSize = config.batchSize;
    this.configuredScenario = config.mockScenario as MockDisconnectionScenario;
    this.gracePeriodDays = overdueLifecycle.gracePeriodDays;
    this.terminationDays = overdueLifecycle.terminationDays;
  }

  async preview(subscriptionId: string, type: CancellationType, actor: AuthenticatedUser) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { customer: { select: { userId: true } }, plan: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    this.workflow.assertCanRequest(subscription, actor);
    if (subscription.status !== SubscriptionStatus.ACTIVE && type !== CancellationType.IMMEDIATE) {
      throw new ConflictException(
        'A pending, past-due, or suspended service can only be cancelled as soon as possible.',
      );
    }
    const calculatedAt = new Date();
    const [outstanding, refund] = await Promise.all([
      this.outstandingBalance(subscription.customerId),
      this.calculateRefundQuote(this.prisma, subscription, type, calculatedAt),
    ]);
    return {
      subscriptionId: subscription.id,
      type,
      currentPlan: subscription.plan,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingAt: subscription.currentPeriodEnd,
      proposedServiceEndAt:
        type === CancellationType.END_OF_PERIOD ? subscription.currentPeriodEnd : calculatedAt,
      outstandingBalanceCents: outstanding,
      currency: 'AUD',
      amountPaidCents: refund.amountPaidCents,
      eligibleRecurringAmountCents: refund.eligibleRecurringAmountCents,
      calculatedProrationCents: refund.calculatedProrationCents,
      previousSuccessfulRefundCents: refund.previousSuccessfulRefundCents,
      remainingRefundableCents: refund.remainingRefundableCents,
      automaticRefundCents: refund.refundAmountCents,
      refundAvailable: refund.refundAmountCents > 0,
      noRefundReason: refund.noRefundReason,
      refundDestination: refund.refundAmountCents > 0 ? 'Original payment method' : null,
      billingMessage:
        type === CancellationType.END_OF_PERIOD
          ? 'Your current billing period remains available until the scheduled service end. No new billing period will be opened after that date.'
          : refund.refundAmountCents > 0
            ? 'This is an estimate. We recalculate the unused service after you confirm and automatically return the final amount to your original payment method once service termination succeeds.'
            : (refund.noRefundReason ??
              'There is no refundable recurring payment for the current billing period.'),
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
            subscription.status !== SubscriptionStatus.ACTIVE &&
            input.type !== CancellationType.IMMEDIATE
          ) {
            throw new ConflictException(
              'A pending, past-due, or suspended service can only be cancelled as soon as possible.',
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
          const activeRelocation = await transaction.serviceRelocation.findFirst({
            where: {
              subscriptionId,
              status: {
                in: [
                  ServiceRelocationStatus.AWAITING_CONFIRMATION,
                  ServiceRelocationStatus.CONFIRMED,
                  ServiceRelocationStatus.PROVISIONING,
                  ServiceRelocationStatus.SCHEDULED,
                  ServiceRelocationStatus.FAILED,
                ],
              },
            },
            select: { id: true },
          });
          if (activeRelocation) {
            throw new ConflictException(
              'A moving-home request is already open. Complete or cancel it before cancelling the service.',
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
          const refundQuote = await this.calculateRefundQuote(
            transaction,
            subscription,
            input.type,
            requestedAt,
          );
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
              refundAmountCents: refundQuote.refundAmountCents,
              refundCalculation: this.refundCalculationJson(
                refundQuote,
                subscription.currentPeriodStart,
                subscription.currentPeriodEnd,
                requestedAt,
              ),
            },
            include: cancellationInclude,
          });
          let finalRefundAmountCents = refundQuote.refundAmountCents;
          if (refundQuote.refundAmountCents > 0 && refundQuote.paymentId) {
            const refund = await this.refunds.createApprovedCancellationRefund(transaction, {
              cancellationRequestId: request.id,
              paymentId: refundQuote.paymentId,
              subscriptionId: subscription.id,
              requestedByUserId: actor.id,
              amountCents: refundQuote.refundAmountCents,
              metadata: this.refundCalculationJson(
                refundQuote,
                subscription.currentPeriodStart,
                subscription.currentPeriodEnd,
                requestedAt,
              ),
            });
            finalRefundAmountCents = refund?.refundAmountCents ?? 0;
            if (finalRefundAmountCents !== refundQuote.refundAmountCents) {
              await transaction.cancellationRequest.update({
                where: { id: request.id },
                data: { refundAmountCents: finalRefundAmountCents },
              });
            }
          }
          assertSubscriptionTransition(
            subscription.status,
            SubscriptionStatus.CANCELLATION_PENDING,
          );
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
          await this.audit(transaction, request, actor, 'CANCELLATION_REFUND_CALCULATED', {
            calculatedProrationCents: refundQuote.calculatedProrationCents,
            previousSuccessfulRefundCents: refundQuote.previousSuccessfulRefundCents,
            remainingRefundableCents: refundQuote.remainingRefundableCents,
            refundAmountCents: finalRefundAmountCents,
            invoiceId: refundQuote.invoiceId,
            paymentId: refundQuote.paymentId,
          });
          const hydrated = await transaction.cancellationRequest.findUniqueOrThrow({
            where: { id: request.id },
            include: cancellationInclude,
          });
          return { request: hydrated, reused: false };
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

    await this.synchronizeStripeCancellation(created.request);
    if (created.reused) {
      if (created.request.status === CancellationStatus.REQUESTED) {
        await this.process(created.request.id);
        return this.customerResponse(await this.load(created.request.id), true);
      }
      return this.customerResponse(created.request, true);
    }
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
    const result = await this.prisma.$transaction(
      async (transaction) => {
        await this.lockSubscription(transaction, subscriptionId);
        const existing = await transaction.cancellationRequest.findFirst({
          where: { subscriptionId, status: { in: openCancellationStatuses } },
          include: cancellationInclude,
        });
        if (!existing) throw new NotFoundException('Open cancellation request not found.');
        this.workflow.assertCanRevoke(existing, actor);
        if (
          existing.subscription.billingMode === BillingMode.STRIPE_RECURRING &&
          existing.subscription.stripeSubscriptionId
        ) {
          await this.stripe!.subscriptions.update(
            existing.subscription.stripeSubscriptionId,
            { cancel_at_period_end: false },
            { idempotencyKey: `revoke-cancellation-${existing.id}` },
          );
        }
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
        const needsProvisioningRestore = await this.restoreAfterCancellation(
          transaction,
          existing,
          revokedAt,
        );
        await this.audit(transaction, existing, actor, 'CANCELLATION_REVOKED', {
          oldStatus: CancellationStatus.SCHEDULED,
          newStatus: CancellationStatus.REVOKED,
        });
        const request = await transaction.cancellationRequest.findUniqueOrThrow({
          where: { id: existing.id },
          include: cancellationInclude,
        });
        return { needsProvisioningRestore, request };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (result.needsProvisioningRestore) {
      await this.provisioning.restoreService(subscriptionId, revokedAt);
    }
    await this.notifyCustomer('REVOKED', result.request);
    await this.dashboardCache.invalidate();
    return this.customerResponse(result.request);
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

    const outcome = await this.applyProviderResult(claimed, result, now);
    const applied = outcome?.request;
    if (outcome?.needsProvisioningRestore) {
      await this.provisioning.restoreService(claimed.request.subscriptionId, now);
    }
    if (applied?.status === CancellationStatus.COMPLETED) {
      if (applied.refund?.status === RefundStatus.APPROVED) {
        try {
          await this.refunds.processAutomatic(applied.refund.id);
        } catch (error: unknown) {
          this.logger.error(
            JSON.stringify({
              event: 'cancellation_refund_processing_failed',
              cancellationRequestId: applied.id,
              refundId: applied.refund.id,
              error: error instanceof Error ? error.name : 'UnknownError',
            }),
          );
        }
      }
      await this.notifyCustomer('COMPLETED', await this.load(applied.id));
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
        let statusBeforeRetry: SubscriptionStatus | undefined;
        if (request.status === CancellationStatus.FAILED) {
          const subscription = await transaction.subscription.findUnique({
            where: { id: request.subscriptionId },
            select: { status: true },
          });
          if (
            !subscription ||
            (subscription.status !== SubscriptionStatus.ACTIVE &&
              subscription.status !== SubscriptionStatus.PENDING &&
              subscription.status !== SubscriptionStatus.PAST_DUE &&
              subscription.status !== SubscriptionStatus.SUSPENDED)
          ) {
            throw new ConflictException(
              'The service cannot re-enter cancellation from its current state.',
            );
          }
          statusBeforeRetry = subscription.status;
          assertSubscriptionTransition(
            subscription.status,
            SubscriptionStatus.CANCELLATION_PENDING,
          );
          const subscriptionChanged = await transaction.subscription.updateMany({
            where: { id: request.subscriptionId, status: subscription.status },
            data: { status: SubscriptionStatus.CANCELLATION_PENDING },
          });
          if (subscriptionChanged.count !== 1) {
            throw new ConflictException('The service changed while cancellation was retried.');
          }
        }
        const scenario = scenarioOverride ?? request.providerScenario ?? this.configuredScenario;
        const changed = await transaction.cancellationRequest.updateMany({
          where: { id, version: request.version, status: request.status },
          data: {
            status: CancellationStatus.PROCESSING,
            processingStartedAt: request.processingStartedAt ?? now,
            failedReason: null,
            providerScenario: scenario,
            subscriptionStatusBefore: statusBeforeRetry,
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
  ): Promise<{ request: CancellationRecord; needsProvisioningRestore: boolean } | null> {
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
        if (claimed.firstSubmission) {
          await this.audit(
            transaction,
            claimed.request,
            undefined,
            'SERVICE_TERMINATION_REQUESTED',
            {
              providerReference: result.providerReference || null,
              providerOperation: claimed.request.providerOperation,
            },
          );
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
          await this.audit(transaction, claimed.request, undefined, 'SERVICE_TERMINATED', {
            providerReference: result.providerReference || null,
          });
          await this.audit(transaction, claimed.request, undefined, 'SUBSCRIPTION_CANCELLED', {
            oldStatus: current.subscriptionStatusBefore,
            newStatus: SubscriptionStatus.CANCELLED,
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
          const needsProvisioningRestore = await this.restoreAfterCancellation(
            transaction,
            current,
            now,
          );
          await this.audit(transaction, claimed.request, undefined, `${operationName}_FAILED`, {
            providerReference: result.providerReference || null,
            providerStatus: result.status,
          });
          const request = await transaction.cancellationRequest.findUniqueOrThrow({
            where: { id: current.id },
            include: cancellationInclude,
          });
          return { request, needsProvisioningRestore };
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
        const request = await transaction.cancellationRequest.findUniqueOrThrow({
          where: { id: current.id },
          include: cancellationInclude,
        });
        return { request, needsProvisioningRestore: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async restoreAfterCancellation(
    transaction: Prisma.TransactionClient,
    request: Pick<CancellationRecord, 'id' | 'subscriptionId' | 'subscriptionStatusBefore'>,
    now: Date,
  ): Promise<boolean> {
    const subscription = await transaction.subscription.findUnique({
      where: { id: request.subscriptionId },
    });
    if (
      !subscription ||
      (subscription.status !== SubscriptionStatus.CANCELLATION_PENDING &&
        subscription.status !== SubscriptionStatus.DISCONNECTION_PENDING)
    ) {
      throw new ConflictException(
        'The service state changed before the cancellation could restore it.',
      );
    }

    const overdueInvoice = await transaction.invoice.findFirst({
      where: {
        subscriptionId: request.subscriptionId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        dueDate: { lte: now },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    if (overdueInvoice?.status === InvoiceStatus.ISSUED) {
      await transaction.invoice.update({
        where: { id: overdueInvoice.id },
        data: { status: InvoiceStatus.OVERDUE, overdueAt: now },
      });
    }

    const previousStatus = request.subscriptionStatusBefore;
    const wasNonPaymentSuspension =
      previousStatus === SubscriptionStatus.SUSPENDED &&
      subscription.suspensionReason === SuspensionReason.NON_PAYMENT;
    const restoredStatus =
      previousStatus === SubscriptionStatus.PENDING
        ? SubscriptionStatus.PENDING
        : previousStatus === SubscriptionStatus.SUSPENDED
          ? overdueInvoice || !wasNonPaymentSuspension
            ? SubscriptionStatus.SUSPENDED
            : SubscriptionStatus.ACTIVE
          : overdueInvoice
            ? SubscriptionStatus.PAST_DUE
            : SubscriptionStatus.ACTIVE;
    const needsProvisioningRestore =
      wasNonPaymentSuspension && restoredStatus === SubscriptionStatus.ACTIVE;
    const overdueAt = overdueInvoice?.overdueAt ?? (overdueInvoice ? now : null);
    const restoringExistingPastDue = previousStatus === SubscriptionStatus.PAST_DUE;
    const pastDueAt = restoringExistingPastDue ? (subscription.pastDueAt ?? overdueAt) : overdueAt;
    const data: Prisma.SubscriptionUpdateManyMutationInput = {
      status: restoredStatus,
      ...(restoredStatus === SubscriptionStatus.PAST_DUE && pastDueAt
        ? {
            pastDueAt,
            gracePeriodEndsAt:
              (restoringExistingPastDue && subscription.gracePeriodEndsAt) ||
              addUtcDays(pastDueAt, this.gracePeriodDays),
            eligibleForTerminationAt:
              (restoringExistingPastDue && subscription.eligibleForTerminationAt) ||
              addUtcDays(pastDueAt, this.terminationDays),
            suspensionReason: null,
            overdueReminderStage: restoringExistingPastDue ? subscription.overdueReminderStage : 0,
            suspensionWarningSentAt: restoringExistingPastDue
              ? subscription.suspensionWarningSentAt
              : null,
          }
        : {}),
      ...(restoredStatus === SubscriptionStatus.ACTIVE
        ? {
            pastDueAt: null,
            gracePeriodEndsAt: null,
            suspendedAt: null,
            suspensionReason: null,
            eligibleForTerminationAt: null,
            terminationReviewQueuedAt: null,
            overdueReminderStage: 0,
            suspensionWarningSentAt: null,
            reactivatedAt: previousStatus === SubscriptionStatus.ACTIVE ? undefined : now,
            provisioningStatus: needsProvisioningRestore
              ? ServiceProvisioningStatus.PENDING
              : undefined,
            provisioningFailure: needsProvisioningRestore ? null : undefined,
          }
        : {}),
    };
    assertSubscriptionTransition(subscription.status, restoredStatus);
    const restored = await transaction.subscription.updateMany({
      where: {
        id: request.subscriptionId,
        status: {
          in: [SubscriptionStatus.CANCELLATION_PENDING, SubscriptionStatus.DISCONNECTION_PENDING],
        },
      },
      data,
    });
    if (restored.count !== 1) {
      throw new ConflictException(
        'The service state changed before the cancellation could restore it.',
      );
    }
    await transaction.auditLog.create({
      data: {
        action: 'SUBSCRIPTION_RESTORED_AFTER_CANCELLATION',
        entityType: 'Subscription',
        entityId: request.subscriptionId,
        metadata: {
          cancellationRequestId: request.id,
          previousStatus: subscription.status,
          restoredStatus,
          overdueInvoiceId: overdueInvoice?.id ?? null,
        },
      },
    });
    return needsProvisioningRestore;
  }

  private async synchronizeStripeCancellation(request: CancellationRecord): Promise<void> {
    const subscription = request.subscription;
    if (
      subscription.billingMode !== BillingMode.STRIPE_RECURRING ||
      !subscription.stripeSubscriptionId
    ) {
      return;
    }
    const stripeSubscription =
      request.type === CancellationType.END_OF_PERIOD
        ? await this.stripe!.subscriptions.update(
            subscription.stripeSubscriptionId,
            { cancel_at_period_end: true },
            { idempotencyKey: `cancel-at-period-end-${request.id}` },
          )
        : await this.stripe!.subscriptions.cancel(
            subscription.stripeSubscriptionId,
            { invoice_now: false, prorate: false },
            { idempotencyKey: `cancel-immediately-${request.id}` },
          );
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        stripeStatus: stripeSubscription.status,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        nextBillingAt: null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'STRIPE_SUBSCRIPTION_CANCELLATION_UPDATED',
        entityType: 'CancellationRequest',
        entityId: request.id,
        metadata: {
          subscriptionId: subscription.id,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          cancellationType: request.type,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        },
      },
    });
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
        cancellationType: request.type,
        refundAmountCents: request.refundAmountCents,
        refundStatus: request.refund?.status ?? null,
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
      refundAmountCents: request.refundAmountCents,
      refund: request.refund
        ? {
            id: request.refund.id,
            status: request.refund.status,
            amountCents: request.refund.refundAmountCents,
            currency: request.refund.currency,
            requestedAt: request.refund.requestedAt,
            processedAt: request.refund.processedAt,
            failedAt: request.refund.failedAt,
          }
        : null,
      plan: request.subscription.plan,
      canRevoke:
        request.status === CancellationStatus.SCHEDULED &&
        request.providerStatus === CancellationProviderStatus.NOT_SUBMITTED &&
        request.effectiveAt > new Date(),
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
          request.providerStatus === CancellationProviderStatus.NOT_SUBMITTED &&
          request.effectiveAt > new Date(),
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

  private async calculateRefundQuote(
    client: Pick<Prisma.TransactionClient, 'invoice' | 'refund'>,
    subscription: {
      id: string;
      billingMode: BillingMode;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
    },
    type: CancellationType,
    calculatedAt: Date,
  ): Promise<CancellationRefundQuote> {
    const empty = (noRefundReason: string): CancellationRefundQuote => ({
      amountPaidCents: 0,
      eligibleRecurringAmountCents: 0,
      calculatedProrationCents: 0,
      previousSuccessfulRefundCents: 0,
      reservedRefundCents: 0,
      remainingRefundableCents: 0,
      refundAmountCents: 0,
      paymentId: null,
      invoiceId: null,
      noRefundReason,
      periodDurationMilliseconds: Math.max(
        0,
        subscription.currentPeriodEnd.getTime() - subscription.currentPeriodStart.getTime(),
      ),
      remainingDurationMilliseconds: Math.max(
        0,
        subscription.currentPeriodEnd.getTime() - calculatedAt.getTime(),
      ),
    });
    if (type !== CancellationType.IMMEDIATE) {
      return empty(
        'No refund is needed because service continues through the paid billing period.',
      );
    }
    if (subscription.billingMode !== BillingMode.STRIPE_RECURRING) {
      return empty('This service does not have a refundable Stripe recurring payment.');
    }
    if (calculatedAt >= subscription.currentPeriodEnd) {
      return empty('The current paid billing period has already ended.');
    }
    const periodStart = this.utcDate(subscription.currentPeriodStart);
    const periodEnd = this.utcDate(new Date(subscription.currentPeriodEnd.getTime() - 1));
    const invoice = await client.invoice.findFirst({
      where: {
        subscriptionId: subscription.id,
        type: InvoiceType.STRIPE_RECURRING,
        status: InvoiceStatus.PAID,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
      },
      include: {
        payments: {
          where: {
            provider: PaymentProvider.STRIPE,
            providerPaymentId: { startsWith: 'pi_' },
            status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED] },
          },
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
    const payment = invoice?.payments[0];
    if (!invoice || !payment) {
      return empty(
        'No successful recurring card payment was found for the current billing period.',
      );
    }
    const [successful, reserved] = await Promise.all([
      client.refund.aggregate({
        where: { paymentId: payment.id, status: RefundStatus.SUCCEEDED },
        _sum: { refundAmountCents: true },
      }),
      client.refund.aggregate({
        where: {
          paymentId: payment.id,
          status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] },
        },
        _sum: { refundAmountCents: true },
      }),
    ]);
    const previousSuccessfulRefundCents = successful._sum.refundAmountCents ?? 0;
    const reservedRefundCents = reserved._sum.refundAmountCents ?? 0;
    const eligibleRecurringAmountCents = Math.min(invoice.totalCents, payment.amountCents);
    const proration = this.billing.calculateCancellationProration({
      paidAmountCents: eligibleRecurringAmountCents,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelledAt: calculatedAt,
    });
    const remainingRefundableCents = Math.max(
      0,
      payment.amountCents - previousSuccessfulRefundCents - reservedRefundCents,
    );
    const refundAmountCents = Math.min(proration.refundCents, remainingRefundableCents);
    return {
      amountPaidCents: payment.amountCents,
      eligibleRecurringAmountCents,
      calculatedProrationCents: proration.refundCents,
      previousSuccessfulRefundCents,
      reservedRefundCents,
      remainingRefundableCents,
      refundAmountCents,
      paymentId: payment.id,
      invoiceId: invoice.id,
      noRefundReason:
        refundAmountCents > 0
          ? null
          : remainingRefundableCents <= 0
            ? 'The current recurring payment has already been fully refunded or reserved.'
            : 'There is no unused paid service remaining in the current billing period.',
      periodDurationMilliseconds: proration.periodDurationMilliseconds,
      remainingDurationMilliseconds: proration.remainingDurationMilliseconds,
    };
  }

  private refundCalculationJson(
    quote: CancellationRefundQuote,
    periodStart: Date,
    periodEnd: Date,
    calculatedAt: Date,
  ): Prisma.InputJsonObject {
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      calculatedAt: calculatedAt.toISOString(),
      amountPaidCents: quote.amountPaidCents,
      eligibleRecurringAmountCents: quote.eligibleRecurringAmountCents,
      calculatedProrationCents: quote.calculatedProrationCents,
      previousSuccessfulRefundCents: quote.previousSuccessfulRefundCents,
      reservedRefundCents: quote.reservedRefundCents,
      remainingRefundableCents: quote.remainingRefundableCents,
      refundAmountCents: quote.refundAmountCents,
      paymentId: quote.paymentId,
      invoiceId: quote.invoiceId,
      noRefundReason: quote.noRefundReason,
      periodDurationMilliseconds: quote.periodDurationMilliseconds,
      remainingDurationMilliseconds: quote.remainingDurationMilliseconds,
      rounding: 'integer-half-up',
    };
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

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
