import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildPaginationMeta, dateRange } from '../../common/pagination';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { SubscriptionQueryDto, UpdateSubscriptionDto } from './dto/subscription.dto';

const include = { customer: true, plan: true } satisfies Prisma.SubscriptionInclude;

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
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
    return {
      data,
      meta: buildPaginationMeta(query, total),
    };
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const where: Prisma.SubscriptionWhereInput =
      actor.role === Role.CUSTOMER ? { id, customer: { userId: actor.id } } : { id };
    const subscription = await this.prisma.subscription.findFirst({ where, include });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    return subscription;
  }

  async findOwn(actor: AuthenticatedUser) {
    return this.prisma.subscription.findMany({
      where: { customer: { userId: actor.id } },
      include,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async update(id: string, input: UpdateSubscriptionDto) {
    const subscription = await this.prisma.subscription.findUnique({ where: { id }, include });
    if (!subscription) throw new NotFoundException('Subscription not found.');
    if (input.status) this.assertTransition(subscription.status, input.status);
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

  private async requireActivePlan(id: string) {
    const plan = await this.prisma.internetPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Internet plan not found.');
    if (!plan.isActive) throw new BadRequestException('An inactive plan cannot be activated.');
  }
  private assertTransition(from: SubscriptionStatus, to: SubscriptionStatus) {
    const allowed: Record<SubscriptionStatus, SubscriptionStatus[]> = {
      PENDING: [SubscriptionStatus.CANCELLED],
      ACTIVE: [SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED],
      SUSPENDED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
      CANCELLED: [],
    };
    if (from !== to && !allowed[from].includes(to))
      throw new BadRequestException(
        `Cannot change a ${from.toLowerCase()} subscription to ${to.toLowerCase()}.`,
      );
  }
}
