import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccountLedgerService } from '../account-ledger/account-ledger.service';
import { collectionHoldState } from './collection-hold.policy';
import { payableCents, suspensionDate, collectionExtension } from './collection-deadline';
import { CollectionPolicyService, type CollectionSettings } from './collection-policy.service';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginationMeta, dateRange } from '../../common/pagination';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { SubscriptionQueryDto, UpdateSubscriptionDto } from './dto/subscription.dto';

const include = {
  customer: {
    include: {
      supportCases: {
        select: { id: true, caseNumber: true, subject: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      },
    },
  },
  plan: true,
  currentServiceAddress: true,
  invoices: {
    where: { status: { in: ['ISSUED', 'OVERDUE'] } },
    orderBy: { dueDate: 'asc' },
    include: { payments: { orderBy: { createdAt: 'desc' } } },
  },
  _count: { select: { invoices: { where: { collectionStage: 'RESOLVED' } } } },
  provisioningRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.SubscriptionInclude;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
    @Optional() private readonly policy?: CollectionPolicyService,
    @Optional() private readonly ledger?: AccountLedgerService,
  ) {}

  async findAll(query: SubscriptionQueryDto) {
    const where: Prisma.SubscriptionWhereInput = query.customerId
      ? { customerId: query.customerId }
      : {};
    if (query.status) where.status = query.status;
    if (query.planId) where.planId = query.planId;
    if (query.billingCycle) where.billingCycle = query.billingCycle;
    if (query.paymentStatus)
      where.invoices = { some: { payments: { some: { status: query.paymentStatus } } } };
    const startDate = dateRange(query.activatedFrom, query.activatedTo);
    if (startDate) where.startDate = startDate;
    if (query.cancelled)
      where.AND = [{ status: query.cancelled === 'true' ? 'CANCELLED' : { not: 'CANCELLED' } }];
    if (query.pendingPlanChange) {
      const pending = {
        status: { in: ['PENDING', 'CHECKOUT_CREATED', 'PROCESSING', 'SCHEDULED'] as const },
      };
      const condition: Prisma.PlanChangeRequestWhereInput = {
        status: { in: [...pending.status.in] },
      };
      where.sourcePlanChanges =
        query.pendingPlanChange === 'true' ? { some: condition } : { none: condition };
    }
    if (query.lifecycle === 'GRACE_EXPIRING') {
      const inTwentyFourHours = new Date(Date.now() + 24 * 60 * 60 * 1000);
      where.status = SubscriptionStatus.PAST_DUE;
      where.gracePeriodEndsAt = { lte: inTwentyFourHours, gt: new Date() };
    }
    if (query.lifecycle === 'ELIGIBLE_FOR_TERMINATION') {
      where.status = SubscriptionStatus.SUSPENDED;
      where.suspensionReason = 'NON_PAYMENT';
      where.eligibleForTerminationAt = { lte: new Date() };
    }
    const search = query.search?.trim();
    if (search)
      where.OR = [
        ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)
          ? [{ id: search }]
          : []),
        ...['firstName', 'lastName', 'email', 'customerNumber'].map((field) => ({
          customer: { [field]: { contains: search, mode: 'insensitive' as const } },
        })),
      ];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include,
        orderBy: [{ [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    const reminderAudits = data.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'Subscription',
            entityId: { in: data.map((subscription) => subscription.id) },
            action: { in: ['OVERDUE_REMINDER_SENT', 'SUSPENSION_WARNING_SENT'] },
          },
          select: { entityId: true },
        })
      : [];
    const reminderCounts = reminderAudits.reduce<Map<string, number>>(
      (counts, audit) => counts.set(audit.entityId, (counts.get(audit.entityId) ?? 0) + 1),
      new Map(),
    );
    const policy = await this.policy?.get();
    const balances = await this.ledger?.previewCollectionBalances(
      this.prisma,
      data.flatMap((s) => s.invoices),
    );
    return {
      data: data.map((subscription) => ({
        ...this.withDeadline(subscription, policy, balances),
        remindersSent:
          (reminderCounts.get(subscription.id) ?? 0) +
          subscription.invoices.reduce(
            (sum, invoice) =>
              sum +
              Number(!!invoice.firstReminderSentAt) +
              Number(!!invoice.secondReminderSentAt) +
              Number(!!invoice.finalWarningSentAt) +
              Number(!!invoice.recoveryFinalWarningSentAt),
            0,
          ),
      })),
      meta: buildPaginationMeta(query, total),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const where: Prisma.SubscriptionWhereInput =
      actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id };
    const subscription = await this.prisma.subscription.findFirst({ where, include });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    return this.withDeadline(
      subscription,
      await this.policy?.get(),
      await this.ledger?.previewCollectionBalances(this.prisma, subscription.invoices),
      actor.role !== Role.CUSTOMER,
    );
  }

  async findOwn(actor: AuthenticatedUser) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { customer: { userId: actor.id } },
      include,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    const policy = await this.policy?.get();
    const balances = await this.ledger?.previewCollectionBalances(
      this.prisma,
      subscriptions.flatMap((s) => s.invoices),
    );
    return subscriptions.map((sub) => this.withDeadline(sub, policy, balances, false));
  }

  async update(id: string, input: UpdateSubscriptionDto) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id }, include });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (input.status && input.status !== subscription.status) {
      throw new BadRequestException(
        'Subscription status changes must use the authorised lifecycle actions.',
      );
    }
    const startDate = input.startDate ? new Date(input.startDate) : subscription.startDate;
    const endDate =
      input.endDate === undefined
        ? subscription.endDate
        : input.endDate === null
          ? null
          : new Date(input.endDate);
    if (endDate && endDate < startDate) {
      throw new BadRequestException('Subscription end date cannot be before its start date.');
    }
    if (input.status === SubscriptionStatus.ACTIVE) {
      await this.requireActivePlan(subscription.planId);
      const other = await this.prisma.subscription.count({
        where: {
          customerId: subscription.customerId,
          status: SubscriptionStatus.ACTIVE,
          id: { not: id },
        },
      });
      if (other)
        throw new ConflictException(
          'The customer already has an active subscription. Cancel or suspend it before activation.',
        );
    }
    const updated = await this.prisma.subscription
      .update({
        where: { id },
        data: {
          ...input,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate:
            input.status === SubscriptionStatus.CANCELLED && input.endDate == null
              ? new Date(Math.max(Date.now(), startDate.getTime()))
              : input.endDate === null
                ? null
                : input.endDate
                  ? new Date(input.endDate)
                  : undefined,
        },
        include,
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('The customer already has an active subscription.');
        }
        throw error;
      });
    await this.dashboardCache.invalidate();
    return updated;
  }

  private withDeadline(
    subscription: Prisma.SubscriptionGetPayload<{ include: typeof include }>,
    policy?: CollectionSettings,
    balances?: Map<string, number>,
    internal = true,
  ) {
    const extension = collectionExtension(subscription.graceExtendedUntil, subscription.invoices);
    const invoices = subscription.invoices.map((invoice) => {
      const date = policy
        ? suspensionDate(invoice, extension, policy, this.policy!.dayMilliseconds)
        : invoice.suspensionScheduledAt;
      return {
        ...invoice,
        outstandingCents: payableCents(invoice),
        effectiveSuspensionDeadline: date,
        suspensionScheduledAt: date,
      };
    });
    const dates = invoices
      .filter((i) => i.outstandingCents > 0 && i.dueDate < new Date())
      .flatMap((i) =>
        i.effectiveSuspensionDeadline ? [i.effectiveSuspensionDeadline.getTime()] : [],
      );
    const holdState = collectionHoldState(
      subscription,
      subscription.invoices,
      new Date(),
      balances,
      Boolean(subscription._count?.invoices),
    );
    return {
      ...subscription,
      ...(!internal
        ? {
            collectionHoldReason: undefined,
            collectionHoldNotes: undefined,
            collectionHoldCreatedBy: undefined,
            collectionHoldCreatedAt: undefined,
            collectionHoldReleasedBy: undefined,
            collectionHoldReleasedAt: undefined,
          }
        : {}),
      collectionHold: {
        ...holdState,
        canPlace: internal && holdState.canPlace,
        canUpdate: internal && holdState.canUpdate,
        canRelease: internal && holdState.canRelease,
        until: subscription.collectionHoldUntil,
        ...(internal
          ? { reason: subscription.collectionHoldReason, notes: subscription.collectionHoldNotes }
          : {}),
      },
      invoices,
      gracePeriodEndsAt: dates.length
        ? new Date(Math.min(...dates))
        : subscription.gracePeriodEndsAt,
    };
  }
  private async requireActivePlan(id: string) {
    const plan = await this.prisma.internetPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Internet plan not found.');
    if (!plan.isActive) throw new BadRequestException('An inactive plan cannot be activated.');
  }
}
