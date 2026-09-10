import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  InvoiceStatus,
  PaymentProvider,
  PaymentStatus,
  PlanChangeStatus,
  PlanChangeType,
  Prisma,
  Role,
  SubscriptionStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { NotificationService } from '../notifications/notification.service';
import { StripeClientService } from '../payments/stripe-client.service';
import type { PlanChangeQueryDto } from './dto/plan-change.dto';

const activeRequestStatuses: PlanChangeStatus[] = [
  PlanChangeStatus.PENDING,
  PlanChangeStatus.CHECKOUT_CREATED,
  PlanChangeStatus.PROCESSING,
  PlanChangeStatus.SCHEDULED,
];

const planChangeInclude = {
  customer: {
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      email: true,
      stripeCustomerId: true,
    },
  },
  sourcePlan: true,
  targetPlan: true,
  sourceSubscription: true,
  newSubscription: true,
  invoice: { select: { id: true, invoiceNumber: true, status: true, totalCents: true } },
  payment: { select: { id: true, status: true, amountCents: true, paidAt: true } },
} satisfies Prisma.PlanChangeRequestInclude;

type PlanChangeRecord = Prisma.PlanChangeRequestGetPayload<{ include: typeof planChangeInclude }>;
interface StripeEventReference {
  id: string;
  type: string;
}

export interface PlanSummary {
  id: string;
  name: string;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

export interface PlanChangePreview {
  type: PlanChangeType;
  currentPlan: PlanSummary;
  targetPlan: PlanSummary;
  currentPlanPriceCents: number;
  targetPlanPriceCents: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  effectiveAt: Date;
  remainingDurationMilliseconds: number;
  unusedCreditCents: number;
  proratedTargetCents: number;
  amountPayableCents: number;
  currency: string;
  calculatedAt: Date;
}

interface ChangeApplicationResult {
  request: PlanChangeRecord;
  outcome: 'APPLIED' | 'FAILED';
}

@Injectable()
export class PlanChangesService {
  private static readonly invoiceSequenceLock = BigInt(873201);
  private readonly logger = new Logger(PlanChangesService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly configService: ConfigService<AppConfig, true>,
    stripeClient: StripeClientService,
    private readonly notifications: NotificationService,
    private readonly dashboardCache: AdminDashboardCacheService,
  ) {
    this.stripe = stripeClient.client;
  }

  preview(
    subscriptionId: string,
    targetPlanId: string,
    actor: AuthenticatedUser,
    calculatedAt = new Date(),
  ): Promise<PlanChangePreview> {
    return this.prisma.$transaction((transaction) =>
      this.buildPreview(transaction, subscriptionId, targetPlanId, actor, calculatedAt, true),
    );
  }

  async request(subscriptionId: string, targetPlanId: string, actor: AuthenticatedUser) {
    const requestedAt = new Date();
    let result: { request: PlanChangeRecord; reused: boolean };
    try {
      result = await this.prisma.$transaction(
        async (transaction) => {
          await this.lockSubscription(transaction, subscriptionId);
          const sourceOwner = await transaction.subscription.findFirst({
            where: { id: subscriptionId, customer: { userId: actor.id } },
            select: { customerId: true },
          });
          if (!sourceOwner) throw new NotFoundException('Subscription not found.');
          const existing = await transaction.planChangeRequest.findFirst({
            where: { sourceSubscriptionId: subscriptionId, status: { in: activeRequestStatuses } },
            include: planChangeInclude,
          });
          if (existing) {
            if (
              existing.targetPlanId === targetPlanId &&
              existing.type === PlanChangeType.UPGRADE &&
              (existing.status === PlanChangeStatus.PENDING ||
                existing.status === PlanChangeStatus.CHECKOUT_CREATED)
            ) {
              return { request: existing, reused: true };
            }
            throw new ConflictException(
              'Another plan change is already pending for this subscription.',
            );
          }

          const preview = await this.buildPreview(
            transaction,
            subscriptionId,
            targetPlanId,
            actor,
            requestedAt,
            false,
          );
          let invoiceId: string | undefined;
          if (preview.type === PlanChangeType.UPGRADE && preview.amountPayableCents > 0) {
            const amounts = this.billing.calculateGstInclusiveAmounts(preview.amountPayableCents);
            const issueDate = this.utcDate(requestedAt);
            await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${PlanChangesService.invoiceSequenceLock})`;
            const invoiceNumber = await this.nextInvoiceNumber(transaction, issueDate);
            const invoice = await transaction.invoice.create({
              data: {
                invoiceNumber,
                customerId: sourceOwner.customerId,
                purchasePlanId: preview.targetPlan.id,
                issueDate,
                dueDate: this.billing.dueDateFor(issueDate),
                ...amounts,
                currency: preview.currency,
                status: InvoiceStatus.ISSUED,
                issuedAt: requestedAt,
                items: {
                  create: {
                    description: `${preview.currentPlan.name} to ${preview.targetPlan.name} prorated plan upgrade`,
                    quantity: 1,
                    unitPriceCents: preview.amountPayableCents,
                    amountCents: preview.amountPayableCents,
                  },
                },
              },
            });
            invoiceId = invoice.id;
          }

          const request = await transaction.planChangeRequest.create({
            data: {
              customerId: sourceOwner.customerId,
              sourceSubscriptionId: subscriptionId,
              sourcePlanId: preview.currentPlan.id,
              targetPlanId: preview.targetPlan.id,
              type: preview.type,
              status:
                preview.type === PlanChangeType.DOWNGRADE
                  ? PlanChangeStatus.SCHEDULED
                  : PlanChangeStatus.PENDING,
              currency: preview.currency,
              sourcePlanPriceCents: preview.currentPlanPriceCents,
              targetPlanPriceCents: preview.targetPlanPriceCents,
              unusedCreditCents: preview.unusedCreditCents,
              proratedTargetCents: preview.proratedTargetCents,
              amountPayableCents: preview.amountPayableCents,
              currentPeriodStartSnapshot: preview.currentPeriodStart,
              currentPeriodEndSnapshot: preview.currentPeriodEnd,
              requestedAt,
              effectiveAt: preview.effectiveAt,
              invoiceId,
            },
            include: planChangeInclude,
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.id,
              action:
                request.type === PlanChangeType.DOWNGRADE
                  ? 'PLAN_DOWNGRADE_SCHEDULED'
                  : 'PLAN_UPGRADE_REQUESTED',
              entityType: 'PlanChangeRequest',
              entityId: request.id,
              metadata: this.auditMetadata(request),
            },
          });
          return { request, reused: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another plan change is already pending. Please retry.');
      }
      throw error;
    }

    if (result.request.type === PlanChangeType.DOWNGRADE) {
      if (!result.reused) await this.notify('SCHEDULED', result.request);
      await this.dashboardCache.invalidate();
      return { planChange: this.toResponse(result.request), checkoutUrl: null };
    }
    if (result.request.amountPayableCents === 0) {
      const applied = await this.applyZeroValueUpgrade(result.request.id, requestedAt);
      await this.notify(applied.outcome, applied.request);
      await this.dashboardCache.invalidate();
      return { planChange: this.toResponse(applied.request), checkoutUrl: null };
    }
    const checkoutUrl = await this.ensureUpgradeCheckout(result.request.id);
    const refreshed = await this.loadRequest(result.request.id);
    await this.dashboardCache.invalidate();
    return { planChange: this.toResponse(refreshed), checkoutUrl };
  }

  async latestForSubscription(subscriptionId: string, actor: AuthenticatedUser) {
    await this.requireOwnedSubscription(subscriptionId, actor);
    const request = await this.prisma.planChangeRequest.findFirst({
      where: { sourceSubscriptionId: subscriptionId },
      include: planChangeInclude,
      orderBy: { createdAt: 'desc' },
    });
    return request ? this.toResponse(request) : null;
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const request = await this.prisma.planChangeRequest.findFirst({
      where: actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id },
      include: planChangeInclude,
    });
    if (!request) throw new NotFoundException('Plan change request not found.');
    const response = this.toResponse(request);
    if (actor.role === Role.CUSTOMER) return response;
    const auditHistory = await this.prisma.auditLog.findMany({
      where: { entityType: 'PlanChangeRequest', entityId: request.id },
      select: {
        id: true,
        entityId: true,
        action: true,
        createdAt: true,
        actorUserId: true,
        metadata: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { ...response, auditHistory };
  }

  async reconcile(id: string, actor: AuthenticatedUser) {
    const request = await this.prisma.planChangeRequest.findFirst({
      where: { id, customer: { userId: actor.id } },
      include: planChangeInclude,
    });
    if (!request) throw new NotFoundException('Plan change request not found.');
    if (request.type !== PlanChangeType.UPGRADE) {
      throw new BadRequestException('Only paid upgrades require Checkout reconciliation.');
    }
    if (
      request.status === PlanChangeStatus.APPLIED ||
      request.status === PlanChangeStatus.FAILED ||
      request.status === PlanChangeStatus.CANCELLED ||
      request.status === PlanChangeStatus.EXPIRED
    ) {
      return this.toResponse(request);
    }
    if (!request.stripeCheckoutSessionId) {
      throw new ConflictException('This upgrade does not have a Checkout Session yet.');
    }

    const session = await this.stripe.checkout.sessions.retrieve(request.stripeCheckoutSessionId);
    await this.reconcileStripeSession(session);
    return this.toResponse(await this.loadRequest(request.id));
  }

  async list(query: PlanChangeQueryDto, actor: AuthenticatedUser) {
    const where: Prisma.PlanChangeRequestWhereInput = {
      ...(actor.role === Role.CUSTOMER
        ? { customer: { userId: actor.id } }
        : query.customerId
          ? { customerId: query.customerId }
          : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.effectiveFrom || query.effectiveTo
        ? {
            effectiveAt: {
              ...(query.effectiveFrom ? { gte: new Date(query.effectiveFrom) } : {}),
              ...(query.effectiveTo ? { lte: new Date(query.effectiveTo) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.planChangeRequest.findMany({
        where,
        include: planChangeInclude,
        orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.planChangeRequest.count({ where }),
    ]);
    const auditHistory =
      actor.role === Role.CUSTOMER || !data.length
        ? []
        : await this.prisma.auditLog.findMany({
            where: {
              entityType: 'PlanChangeRequest',
              entityId: { in: data.map((request) => request.id) },
            },
            select: {
              id: true,
              entityId: true,
              action: true,
              createdAt: true,
              actorUserId: true,
              metadata: true,
            },
            orderBy: { createdAt: 'desc' },
          });
    const auditsByRequest = new Map<string, typeof auditHistory>();
    for (const audit of auditHistory) {
      const existing = auditsByRequest.get(audit.entityId) ?? [];
      existing.push(audit);
      auditsByRequest.set(audit.entityId, existing);
    }
    return {
      data: data.map((request) => ({
        ...this.toResponse(request),
        ...(actor.role === Role.CUSTOMER
          ? {}
          : { auditHistory: auditsByRequest.get(request.id) ?? [] }),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async cancelScheduled(id: string, actor: AuthenticatedUser) {
    const cancelledAt = new Date();
    const request = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.planChangeRequest.findFirst({
        where: { id, customer: { userId: actor.id } },
        include: planChangeInclude,
      });
      if (!existing) throw new NotFoundException('Plan change request not found.');
      if (existing.status !== PlanChangeStatus.SCHEDULED || existing.effectiveAt <= cancelledAt) {
        throw new ConflictException('This scheduled downgrade can no longer be cancelled.');
      }
      const updated = await transaction.planChangeRequest.update({
        where: { id },
        data: {
          status: PlanChangeStatus.CANCELLED,
          cancelledAt,
          cancellationReason: 'CUSTOMER_CANCELLED',
        },
        include: planChangeInclude,
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'SCHEDULED_DOWNGRADE_CANCELLED',
          entityType: 'PlanChangeRequest',
          entityId: id,
          metadata: this.auditMetadata(updated),
        },
      });
      return updated;
    });
    await this.notify('CANCELLED', request);
    await this.dashboardCache.invalidate();
    return this.toResponse(request);
  }

  async processStripeEvent(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<void> {
    if (event.type === 'checkout.session.expired') {
      await this.recordTerminalCheckout(
        event,
        session,
        PlanChangeStatus.EXPIRED,
        'CHECKOUT_EXPIRED',
      );
      return;
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      await this.recordTerminalCheckout(event, session, PlanChangeStatus.FAILED, 'PAYMENT_FAILED');
      return;
    }
    if (event.type === 'checkout.session.completed' && session.payment_status !== 'paid') {
      await this.recordProcessingCheckout(event, session);
      return;
    }
    if (
      (event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded') &&
      session.payment_status === 'paid'
    ) {
      const result = await this.applyPaidUpgrade(event, session);
      if (result) await this.notify(result.outcome, result.request);
      await this.dashboardCache.invalidate();
    }
  }

  private async reconcileStripeSession(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status === 'paid') {
      const event: StripeEventReference = {
        id: `reconcile:${session.id}:paid`,
        type: 'server.checkout_reconciliation',
      };
      const result = await this.applyPaidUpgrade(event, session);
      if (result) await this.notify(result.outcome, result.request);
      await this.dashboardCache.invalidate();
      return;
    }
    if (session.status === 'expired') {
      const event: StripeEventReference = {
        id: `reconcile:${session.id}:expired`,
        type: 'server.checkout_expired',
      };
      await this.recordTerminalCheckout(
        event,
        session,
        PlanChangeStatus.EXPIRED,
        'CHECKOUT_EXPIRED',
      );
      return;
    }
    if (session.status === 'complete') {
      const event: StripeEventReference = {
        id: `reconcile:${session.id}:processing`,
        type: 'server.checkout_processing',
      };
      await this.recordProcessingCheckout(event, session);
    }
  }

  async reconcileDueDowngrades(now = new Date()): Promise<number> {
    const due = await this.prisma.planChangeRequest.findMany({
      where: { status: PlanChangeStatus.SCHEDULED, effectiveAt: { lte: now } },
      select: { id: true },
      orderBy: { effectiveAt: 'asc' },
      take: 50,
    });
    for (const request of due) {
      try {
        const result = await this.applyScheduledDowngrade(request.id, now);
        if (result) await this.notify(result.outcome, result.request);
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            event: 'scheduled_plan_change_reconciliation_failed',
            planChangeRequestId: request.id,
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
        throw error;
      }
    }
    const advancedPeriods = await this.reconcileExpiredBillingPeriods(now);
    if (due.length || advancedPeriods) await this.dashboardCache.invalidate();
    return due.length;
  }

  private async reconcileExpiredBillingPeriods(now: Date): Promise<number> {
    let advanced = 0;
    for (;;) {
      const candidates = await this.prisma.subscription.findMany({
        where: {
          status: SubscriptionStatus.ACTIVE,
          billingCycle: BillingCycle.MONTHLY,
          currentPeriodEnd: { lte: now },
          sourcePlanChanges: { none: { status: { in: activeRequestStatuses } } },
        },
        select: { id: true },
        orderBy: { currentPeriodEnd: 'asc' },
        take: 50,
      });
      if (!candidates.length) return advanced;

      let batchProgress = 0;
      for (const candidate of candidates) {
        const didAdvance = await this.prisma.$transaction(
          async (transaction) => {
            await this.lockSubscription(transaction, candidate.id);
            const subscription = await transaction.subscription.findUnique({
              where: { id: candidate.id },
            });
            if (
              !subscription ||
              subscription.status !== SubscriptionStatus.ACTIVE ||
              subscription.billingCycle !== BillingCycle.MONTHLY ||
              subscription.currentPeriodEnd > now
            ) {
              return false;
            }
            const activeChange = await transaction.planChangeRequest.count({
              where: {
                sourceSubscriptionId: subscription.id,
                status: { in: activeRequestStatuses },
              },
            });
            if (activeChange) return false;

            const previousStart = subscription.currentPeriodStart;
            const previousEnd = subscription.currentPeriodEnd;
            let currentPeriodStart = previousEnd;
            let currentPeriodEnd = this.billing.nextMonthlyBoundary(
              currentPeriodStart,
              subscription.billingAnchorDay,
            );
            while (currentPeriodEnd <= now) {
              currentPeriodStart = currentPeriodEnd;
              currentPeriodEnd = this.billing.nextMonthlyBoundary(
                currentPeriodStart,
                subscription.billingAnchorDay,
              );
            }
            const updated = await transaction.subscription.updateMany({
              where: {
                id: subscription.id,
                status: SubscriptionStatus.ACTIVE,
                currentPeriodStart: previousStart,
                currentPeriodEnd: previousEnd,
              },
              data: { currentPeriodStart, currentPeriodEnd },
            });
            if (updated.count !== 1) return false;
            await transaction.auditLog.create({
              data: {
                action: 'SUBSCRIPTION_BILLING_PERIOD_ADVANCED',
                entityType: 'Subscription',
                entityId: subscription.id,
                metadata: {
                  previousPeriodStart: previousStart.toISOString(),
                  previousPeriodEnd: previousEnd.toISOString(),
                  currentPeriodStart: currentPeriodStart.toISOString(),
                  currentPeriodEnd: currentPeriodEnd.toISOString(),
                },
              },
            });
            return true;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (didAdvance) {
          advanced += 1;
          batchProgress += 1;
        }
      }
      // Every candidate changed concurrently or acquired a plan change. A later worker run retries.
      if (!batchProgress || candidates.length < 50) return advanced;
    }
  }

  private async buildPreview(
    transaction: Prisma.TransactionClient,
    subscriptionId: string,
    targetPlanId: string,
    actor: AuthenticatedUser,
    calculatedAt: Date,
    rejectExistingRequest: boolean,
  ): Promise<PlanChangePreview> {
    const subscription = await transaction.subscription.findFirst({
      where:
        actor.role === Role.CUSTOMER
          ? { id: subscriptionId, customer: { userId: actor.id } }
          : { id: subscriptionId },
      include: { plan: true, customer: { select: { id: true } } },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (
      subscription.status === SubscriptionStatus.CANCELLATION_PENDING ||
      subscription.status === SubscriptionStatus.DISCONNECTION_PENDING
    ) {
      throw new ConflictException(
        'A cancellation is already in progress for this subscription.',
      );
    }
    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException('Only an active subscription can change plans.');
    }
    if (subscription.billingCycle !== BillingCycle.MONTHLY) {
      throw new BadRequestException('This billing interval does not support plan changes.');
    }
    if (subscription.planId === targetPlanId) {
      throw new BadRequestException('The selected plan is already active.');
    }
    const targetPlan = await transaction.internetPlan.findUnique({ where: { id: targetPlanId } });
    if (!targetPlan) throw new NotFoundException('Target internet plan not found.');
    if (!targetPlan.isActive || !targetPlan.isPublic || !targetPlan.isAvailable) {
      throw new BadRequestException('The selected plan is not available to customers.');
    }
    const blockingInvoices = await transaction.invoice.count({
      where: {
        customerId: subscription.customerId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
      },
    });
    if (blockingInvoices) {
      throw new ConflictException('Pay all outstanding invoices before changing plans.');
    }
    const cancellation = await transaction.cancellationRequest.count({
      where: {
        subscriptionId: subscription.id,
        status: {
          in: ['REQUESTED', 'SCHEDULED', 'PROCESSING', 'DISCONNECTION_PENDING', 'FAILED'],
        },
      },
    });
    if (cancellation) {
      throw new ConflictException(
        'A cancellation is already open for this subscription. Revoke or complete it before changing plans.',
      );
    }
    if (rejectExistingRequest) {
      const pending = await transaction.planChangeRequest.count({
        where: { sourceSubscriptionId: subscription.id, status: { in: activeRequestStatuses } },
      });
      if (pending) {
        throw new ConflictException('Another plan change is already pending.');
      }
    }
    const proration = this.billing.calculatePlanChangeProration({
      sourcePriceCents: subscription.plan.monthlyCents,
      targetPriceCents: targetPlan.monthlyCents,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      calculatedAt,
    });
    return {
      type: proration.type as PlanChangeType,
      currentPlan: this.planSummary(subscription.plan),
      targetPlan: this.planSummary(targetPlan),
      currentPlanPriceCents: subscription.plan.monthlyCents,
      targetPlanPriceCents: targetPlan.monthlyCents,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      effectiveAt: proration.effectiveAt,
      remainingDurationMilliseconds: proration.remainingDurationMilliseconds,
      unusedCreditCents: proration.unusedCreditCents,
      proratedTargetCents: proration.proratedTargetCents,
      amountPayableCents: proration.amountPayableCents,
      currency: 'AUD',
      calculatedAt,
    };
  }

  private async ensureUpgradeCheckout(requestId: string): Promise<string | null> {
    const request = await this.loadRequest(requestId);
    if (request.type !== PlanChangeType.UPGRADE || request.amountPayableCents <= 0) {
      throw new BadRequestException('This plan change does not require Checkout.');
    }
    if (request.status === PlanChangeStatus.CHECKOUT_CREATED && request.stripeCheckoutSessionId) {
      const existing = await this.stripe.checkout.sessions.retrieve(
        request.stripeCheckoutSessionId,
      );
      if (existing.status === 'open' && existing.url) return existing.url;
      if (existing.payment_status === 'paid' || existing.status === 'expired') {
        await this.reconcileStripeSession(existing);
        return null;
      }
      if (existing.status === 'complete') {
        await this.reconcileStripeSession(existing);
        return null;
      }
      throw new ConflictException('The existing upgrade Checkout can no longer be reused.');
    }
    if (request.status !== PlanChangeStatus.PENDING || !request.invoice) {
      throw new ConflictException('This upgrade is not ready for Checkout.');
    }
    const metadata = {
      checkoutKind: 'plan_change',
      planChangeRequestId: request.id,
      sourceSubscriptionId: request.sourceSubscriptionId,
      targetPlanId: request.targetPlanId,
    };
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        {
          mode: 'payment',
          integration_identifier: `mero_telecom_plan_change_${this.randomLetters(8)}`,
          ...(request.customer.stripeCustomerId
            ? { customer: request.customer.stripeCustomerId }
            : { customer_email: request.customer.email }),
          client_reference_id: request.id,
          metadata,
          payment_intent_data: { metadata },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: request.currency.toLowerCase(),
                unit_amount: request.amountPayableCents,
                product_data: {
                  name: `${request.sourcePlan.name} to ${request.targetPlan.name} prorated upgrade`,
                },
              },
            },
          ],
          expires_at: Math.floor(expiresAt.getTime() / 1000),
          success_url: `${this.frontendUrl()}/customer/subscription?planChange=success&requestId=${request.id}`,
          cancel_url: `${this.frontendUrl()}/customer/subscription?planChange=cancelled&requestId=${request.id}`,
        },
        { idempotencyKey: `plan-change-checkout-${request.id}` },
      );
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'plan_change_checkout_creation_failed',
          planChangeRequestId: request.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      throw new ServiceUnavailableException(
        'Stripe Checkout is temporarily unavailable. Your subscription has not changed. Please try again.',
      );
    }
    if (!session.url) throw new BadRequestException('Stripe did not return a Checkout URL.');

    try {
      await this.prisma.$transaction(async (transaction) => {
        await this.lockSubscription(transaction, request.sourceSubscriptionId);
        const current = await transaction.planChangeRequest.findUnique({
          where: { id: request.id },
        });
        if (!current) throw new NotFoundException('Plan change request not found.');
        if (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== session.id) {
          throw new ConflictException('Another upgrade Checkout already exists.');
        }
        if (
          current.status !== PlanChangeStatus.PENDING &&
          current.status !== PlanChangeStatus.CHECKOUT_CREATED
        ) {
          throw new ConflictException('This upgrade is no longer awaiting Checkout.');
        }
        const payment = await transaction.payment.upsert({
          where: { providerSessionId: session.id },
          create: {
            invoiceId: request.invoice!.id,
            customerId: request.customerId,
            provider: PaymentProvider.STRIPE,
            providerSessionId: session.id,
            amountCents: request.amountPayableCents,
            currency: request.currency,
            status: PaymentStatus.PENDING,
          },
          update: {},
        });
        await transaction.planChangeRequest.update({
          where: { id: request.id },
          data: {
            status: PlanChangeStatus.CHECKOUT_CREATED,
            stripeCheckoutSessionId: session.id,
            paymentId: payment.id,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'PLAN_UPGRADE_CHECKOUT_CREATED',
            entityType: 'PlanChangeRequest',
            entityId: request.id,
            metadata: this.auditMetadata(request),
          },
        });
      });
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
    return session.url;
  }

  private async recordProcessingCheckout(
    event: StripeEventReference,
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const requestId = this.requestIdFromSession(session);
    await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return;
      }
      const request = await transaction.planChangeRequest.findUnique({ where: { id: requestId } });
      this.assertSessionMatchesRequest(request, session);
      await transaction.planChangeRequest.updateMany({
        where: { id: requestId, status: PlanChangeStatus.CHECKOUT_CREATED },
        data: { status: PlanChangeStatus.PROCESSING },
      });
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
          paymentId: request?.paymentId,
          planChangeRequestId: requestId,
        },
      });
    });
  }

  private async recordTerminalCheckout(
    event: StripeEventReference,
    session: Stripe.Checkout.Session,
    status: PlanChangeStatus,
    reason: string,
  ): Promise<void> {
    const requestId = this.requestIdFromSession(session);
    const request = await this.prisma.$transaction(async (transaction) => {
      if (
        await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
      ) {
        return null;
      }
      const current = await transaction.planChangeRequest.findUnique({
        where: { id: requestId },
        include: planChangeInclude,
      });
      this.assertSessionMatchesRequest(current, session);
      if (
        current!.status === PlanChangeStatus.CHECKOUT_CREATED ||
        current!.status === PlanChangeStatus.PROCESSING ||
        current!.status === PlanChangeStatus.PENDING
      ) {
        await transaction.planChangeRequest.update({
          where: { id: requestId },
          data: { status, failureReason: reason },
        });
        if (current!.invoiceId) {
          await transaction.invoice.updateMany({
            where: {
              id: current!.invoiceId,
              status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
            },
            data: { status: InvoiceStatus.CANCELLED },
          });
        }
        if (current!.paymentId) {
          await transaction.payment.updateMany({
            where: { id: current!.paymentId, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.FAILED },
          });
        }
        await transaction.auditLog.create({
          data: {
            action:
              status === PlanChangeStatus.EXPIRED
                ? 'PLAN_CHANGE_CHECKOUT_EXPIRED'
                : 'PLAN_CHANGE_FAILED',
            entityType: 'PlanChangeRequest',
            entityId: requestId,
            metadata: { ...this.auditMetadata(current!), reason },
          },
        });
      }
      await transaction.paymentWebhookEvent.create({
        data: {
          provider: PaymentProvider.STRIPE,
          providerEventId: event.id,
          eventType: event.type,
          paymentId: current!.paymentId,
          planChangeRequestId: requestId,
        },
      });
      return transaction.planChangeRequest.findUnique({
        where: { id: requestId },
        include: planChangeInclude,
      });
    });
    if (request && (request.status === status || request.failureReason === reason)) {
      await this.notify('FAILED', request);
    }
    await this.dashboardCache.invalidate();
  }

  private async applyPaidUpgrade(
    event: StripeEventReference,
    session: Stripe.Checkout.Session,
  ): Promise<ChangeApplicationResult | null> {
    const requestId = this.requestIdFromSession(session);
    return this.prisma.$transaction(
      async (transaction) => {
        if (
          await transaction.paymentWebhookEvent.findUnique({ where: { providerEventId: event.id } })
        ) {
          return null;
        }
        const request = await transaction.planChangeRequest.findUnique({
          where: { id: requestId },
          include: planChangeInclude,
        });
        this.assertSessionMatchesRequest(request, session);
        if (!request || request.type !== PlanChangeType.UPGRADE) {
          throw new BadRequestException('Stripe Checkout does not reference an upgrade.');
        }
        if (
          request.amountPayableCents !== session.amount_total ||
          request.currency !== session.currency?.toUpperCase()
        ) {
          throw new BadRequestException('Stripe Checkout amount does not match the plan change.');
        }
        if (!request.paymentId || !request.invoiceId) {
          throw new BadRequestException('The plan-change payment record is missing.');
        }
        if (
          request.status !== PlanChangeStatus.CHECKOUT_CREATED &&
          request.status !== PlanChangeStatus.PROCESSING
        ) {
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
              paymentId: request.paymentId,
              planChangeRequestId: request.id,
            },
          });
          return null;
        }
        await this.lockSubscription(transaction, request.sourceSubscriptionId);
        const paidAt = new Date();
        const paymentIntentId = this.stripeId(session.payment_intent);
        const failureReason = await this.applicationFailureReason(
          transaction,
          request,
          paidAt,
          request.invoiceId,
          true,
        );
        await transaction.payment.update({
          where: { id: request.paymentId },
          data: {
            providerPaymentId: paymentIntentId,
            status: PaymentStatus.SUCCEEDED,
            paidAt,
          },
        });
        await transaction.invoice.update({
          where: { id: request.invoiceId },
          data: { status: InvoiceStatus.PAID, paidAt },
        });
        if (failureReason) {
          const failed = await transaction.planChangeRequest.update({
            where: { id: request.id },
            data: {
              status: PlanChangeStatus.FAILED,
              failureReason,
              stripePaymentIntentId: paymentIntentId,
            },
            include: planChangeInclude,
          });
          await transaction.paymentWebhookEvent.create({
            data: {
              provider: PaymentProvider.STRIPE,
              providerEventId: event.id,
              eventType: event.type,
              paymentId: request.paymentId,
              planChangeRequestId: request.id,
            },
          });
          await transaction.auditLog.create({
            data: {
              action: 'PAID_PLAN_CHANGE_REQUIRES_REVIEW',
              entityType: 'PlanChangeRequest',
              entityId: request.id,
              metadata: { ...this.auditMetadata(request), reason: failureReason },
            },
          });
          return { request: failed, outcome: 'FAILED' };
        }

        const newSubscription = await this.transitionSubscription(
          transaction,
          request,
          paidAt,
          request.currentPeriodEndSnapshot,
          'PLAN_UPGRADE',
        );
        await transaction.invoice.update({
          where: { id: request.invoiceId },
          data: { subscriptionId: newSubscription.id },
        });
        const applied = await transaction.planChangeRequest.update({
          where: { id: request.id },
          data: {
            status: PlanChangeStatus.APPLIED,
            newSubscriptionId: newSubscription.id,
            stripePaymentIntentId: paymentIntentId,
            effectiveAt: paidAt,
            appliedAt: paidAt,
          },
          include: planChangeInclude,
        });
        await transaction.paymentWebhookEvent.create({
          data: {
            provider: PaymentProvider.STRIPE,
            providerEventId: event.id,
            eventType: event.type,
            paymentId: request.paymentId,
            planChangeRequestId: request.id,
          },
        });
        await transaction.auditLog.createMany({
          data: [
            {
              action: 'PLAN_UPGRADE_PAYMENT_COMPLETED',
              entityType: 'PlanChangeRequest',
              entityId: request.id,
              metadata: this.auditMetadata(applied),
            },
            {
              action: 'PLAN_CHANGE_APPLIED',
              entityType: 'Subscription',
              entityId: newSubscription.id,
              metadata: this.auditMetadata(applied),
            },
          ],
        });
        return { request: applied, outcome: 'APPLIED' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applyZeroValueUpgrade(
    requestId: string,
    appliedAt: Date,
  ): Promise<ChangeApplicationResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        const request = await transaction.planChangeRequest.findUnique({
          where: { id: requestId },
          include: planChangeInclude,
        });
        if (!request || request.status !== PlanChangeStatus.PENDING) {
          throw new ConflictException('This plan change is no longer pending.');
        }
        await this.lockSubscription(transaction, request.sourceSubscriptionId);
        const failureReason = await this.applicationFailureReason(
          transaction,
          request,
          appliedAt,
          undefined,
          true,
        );
        if (failureReason) {
          const failed = await transaction.planChangeRequest.update({
            where: { id: request.id },
            data: { status: PlanChangeStatus.FAILED, failureReason },
            include: planChangeInclude,
          });
          return { request: failed, outcome: 'FAILED' };
        }
        const newSubscription = await this.transitionSubscription(
          transaction,
          request,
          appliedAt,
          request.currentPeriodEndSnapshot,
          'ZERO_VALUE_PLAN_UPGRADE',
        );
        const applied = await transaction.planChangeRequest.update({
          where: { id: request.id },
          data: {
            status: PlanChangeStatus.APPLIED,
            newSubscriptionId: newSubscription.id,
            effectiveAt: appliedAt,
            appliedAt,
          },
          include: planChangeInclude,
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: request.customer.userId,
            action: 'ZERO_VALUE_PLAN_UPGRADE_APPLIED',
            entityType: 'PlanChangeRequest',
            entityId: request.id,
            metadata: this.auditMetadata(applied),
          },
        });
        return { request: applied, outcome: 'APPLIED' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applyScheduledDowngrade(
    requestId: string,
    now: Date,
  ): Promise<ChangeApplicationResult | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const request = await transaction.planChangeRequest.findUnique({
          where: { id: requestId },
          include: planChangeInclude,
        });
        if (!request || request.status !== PlanChangeStatus.SCHEDULED) return null;
        await this.lockSubscription(transaction, request.sourceSubscriptionId);
        const failureReason = await this.applicationFailureReason(
          transaction,
          request,
          now,
          undefined,
          false,
        );
        if (failureReason) {
          const failed = await transaction.planChangeRequest.update({
            where: { id: request.id },
            data: { status: PlanChangeStatus.FAILED, failureReason },
            include: planChangeInclude,
          });
          await transaction.auditLog.create({
            data: {
              action: 'SCHEDULED_DOWNGRADE_FAILED',
              entityType: 'PlanChangeRequest',
              entityId: request.id,
              metadata: { ...this.auditMetadata(request), reason: failureReason },
            },
          });
          return { request: failed, outcome: 'FAILED' };
        }
        const nextBoundary = this.billing.nextMonthlyBoundary(
          request.effectiveAt,
          request.sourceSubscription.billingAnchorDay,
        );
        const newSubscription = await this.transitionSubscription(
          transaction,
          request,
          request.effectiveAt,
          nextBoundary,
          'PLAN_DOWNGRADE',
        );
        const applied = await transaction.planChangeRequest.update({
          where: { id: request.id },
          data: {
            status: PlanChangeStatus.APPLIED,
            newSubscriptionId: newSubscription.id,
            appliedAt: now,
          },
          include: planChangeInclude,
        });
        await transaction.auditLog.create({
          data: {
            action: 'SCHEDULED_DOWNGRADE_APPLIED',
            entityType: 'PlanChangeRequest',
            entityId: request.id,
            metadata: this.auditMetadata(applied),
          },
        });
        return { request: applied, outcome: 'APPLIED' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applicationFailureReason(
    transaction: Prisma.TransactionClient,
    request: PlanChangeRecord,
    now: Date,
    excludedInvoiceId: string | undefined,
    mustRemainInsidePeriod: boolean,
  ): Promise<string | null> {
    const source = await transaction.subscription.findUnique({
      where: { id: request.sourceSubscriptionId },
    });
    const target = await transaction.internetPlan.findUnique({
      where: { id: request.targetPlanId },
    });
    if (!source || source.status !== SubscriptionStatus.ACTIVE) return 'SOURCE_NOT_ACTIVE';
    if (source.billingCycle !== BillingCycle.MONTHLY) return 'INCOMPATIBLE_BILLING_INTERVAL';
    if (
      source.currentPeriodStart.getTime() !== request.currentPeriodStartSnapshot.getTime() ||
      source.currentPeriodEnd.getTime() !== request.currentPeriodEndSnapshot.getTime()
    ) {
      return 'BILLING_PERIOD_CHANGED';
    }
    if (mustRemainInsidePeriod && now >= source.currentPeriodEnd) return 'BILLING_PERIOD_ENDED';
    if (!target || !target.isActive || !target.isPublic || !target.isAvailable) {
      return 'TARGET_PLAN_UNAVAILABLE';
    }
    if (target.monthlyCents !== request.targetPlanPriceCents) return 'TARGET_PRICE_CHANGED';
    if (request.sourcePlan.monthlyCents !== request.sourcePlanPriceCents) {
      return 'SOURCE_PRICE_CHANGED';
    }
    const blockers = await transaction.invoice.count({
      where: {
        customerId: request.customerId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        ...(excludedInvoiceId ? { id: { not: excludedInvoiceId } } : {}),
      },
    });
    return blockers ? 'OUTSTANDING_INVOICE' : null;
  }

  private async transitionSubscription(
    transaction: Prisma.TransactionClient,
    request: PlanChangeRecord,
    effectiveAt: Date,
    newPeriodEnd: Date,
    endReason: string,
  ) {
    const ended = await transaction.subscription.updateMany({
      where: {
        id: request.sourceSubscriptionId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: request.currentPeriodStartSnapshot,
        currentPeriodEnd: request.currentPeriodEndSnapshot,
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
        endDate: this.utcDate(effectiveAt),
        endReason,
      },
    });
    if (ended.count !== 1) {
      throw new ConflictException(
        'The source subscription changed before the plan change applied.',
      );
    }
    return transaction.subscription.create({
      data: {
        customerId: request.customerId,
        planId: request.targetPlanId,
        status: SubscriptionStatus.ACTIVE,
        startDate: this.utcDate(effectiveAt),
        billingCycle: request.sourceSubscription.billingCycle,
        billingAnchorDay: request.sourceSubscription.billingAnchorDay,
        currentPeriodStart: effectiveAt,
        currentPeriodEnd: newPeriodEnd,
      },
    });
  }

  private async notify(
    event: 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'FAILED',
    request: PlanChangeRecord,
  ): Promise<void> {
    try {
      await this.notifications.sendPlanChangeNotification({
        event,
        planChangeRequestId: request.id,
        customerName: `${request.customer.firstName} ${request.customer.lastName}`,
        customerEmail: request.customer.email,
        oldPlanName: request.sourcePlan.name,
        newPlanName: request.targetPlan.name,
        amountCents: request.amountPayableCents,
        currency: request.currency,
        effectiveAt: request.effectiveAt,
        nextBillingAt:
          request.type === PlanChangeType.UPGRADE
            ? request.currentPeriodEndSnapshot
            : this.billing.nextMonthlyBoundary(
                request.effectiveAt,
                request.sourceSubscription.billingAnchorDay,
              ),
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'plan_change_email_enqueue_failed',
          planChangeRequestId: request.id,
          notification: event,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private async loadRequest(id: string): Promise<PlanChangeRecord> {
    const request = await this.prisma.planChangeRequest.findUnique({
      where: { id },
      include: planChangeInclude,
    });
    if (!request) throw new NotFoundException('Plan change request not found.');
    return request;
  }

  private async requireOwnedSubscription(id: string, actor: AuthenticatedUser): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, customer: { userId: actor.id } },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found.');
  }

  private assertSessionMatchesRequest(
    request: {
      id: string;
      stripeCheckoutSessionId: string | null;
      sourceSubscriptionId: string;
      targetPlanId: string;
    } | null,
    session: Stripe.Checkout.Session,
  ): void {
    if (
      !request ||
      request.stripeCheckoutSessionId !== session.id ||
      session.metadata?.checkoutKind !== 'plan_change' ||
      session.metadata.planChangeRequestId !== request.id ||
      session.metadata.sourceSubscriptionId !== request.sourceSubscriptionId ||
      session.metadata.targetPlanId !== request.targetPlanId ||
      session.client_reference_id !== request.id
    ) {
      throw new BadRequestException('Stripe Checkout does not match the plan change request.');
    }
  }

  private requestIdFromSession(session: Stripe.Checkout.Session): string {
    const id = session.metadata?.planChangeRequestId;
    if (!id) throw new BadRequestException('Stripe Checkout is missing a plan-change reference.');
    return id;
  }

  private async lockSubscription(
    transaction: Prisma.TransactionClient,
    subscriptionId: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subscriptionId}))`;
  }

  private async nextInvoiceNumber(
    transaction: Prisma.TransactionClient,
    issueDate: Date,
  ): Promise<string> {
    const year = issueDate.getUTCFullYear();
    const latest = await transaction.invoice.findFirst({
      where: { invoiceNumber: { startsWith: `INV-${year}-` } },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    });
    const sequence = latest ? Number(latest.invoiceNumber.split('-').at(-1)) + 1 : 1;
    return `INV-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private toResponse(request: PlanChangeRecord) {
    return {
      id: request.id,
      customer: {
        id: request.customer.id,
        firstName: request.customer.firstName,
        lastName: request.customer.lastName,
      },
      sourceSubscriptionId: request.sourceSubscriptionId,
      newSubscriptionId: request.newSubscriptionId,
      currentPlan: this.planSummary(request.sourcePlan),
      targetPlan: this.planSummary(request.targetPlan),
      type: request.type,
      status: request.status,
      currency: request.currency,
      currentPlanPriceCents: request.sourcePlanPriceCents,
      targetPlanPriceCents: request.targetPlanPriceCents,
      unusedCreditCents: request.unusedCreditCents,
      proratedTargetCents: request.proratedTargetCents,
      amountPayableCents: request.amountPayableCents,
      currentPeriodStart: request.currentPeriodStartSnapshot,
      currentPeriodEnd: request.currentPeriodEndSnapshot,
      requestedAt: request.requestedAt,
      effectiveAt: request.effectiveAt,
      appliedAt: request.appliedAt,
      cancelledAt: request.cancelledAt,
      failureReason: request.failureReason,
      invoice: request.invoice,
      payment: request.payment,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private planSummary(plan: {
    id: string;
    name: string;
    downloadMbps: number;
    uploadMbps: number;
    monthlyCents: number;
  }): PlanSummary {
    return {
      id: plan.id,
      name: plan.name,
      downloadMbps: plan.downloadMbps,
      uploadMbps: plan.uploadMbps,
      monthlyCents: plan.monthlyCents,
    };
  }

  private auditMetadata(request: PlanChangeRecord) {
    return {
      planChangeRequestId: request.id,
      customerId: request.customerId,
      sourceSubscriptionId: request.sourceSubscriptionId,
      sourcePlanId: request.sourcePlanId,
      targetPlanId: request.targetPlanId,
      planChangeType: request.type,
      amountPayableCents: request.amountPayableCents,
      currency: request.currency,
      effectiveAt: request.effectiveAt.toISOString(),
    };
  }

  private frontendUrl(): string {
    return this.configService.getOrThrow('app').frontendUrl;
  }

  private randomLetters(length: number): string {
    return Array.from(randomBytes(length), (value) => String.fromCharCode(97 + (value % 26))).join(
      '',
    );
  }

  private stripeId(value: string | { id: string } | null): string | undefined {
    return typeof value === 'string' ? value : value?.id;
  }

  private utcDate(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
}
