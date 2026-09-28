import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InternetPlan, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import type { AuditRequestContext } from '../system-users/system-users.types';
import { StripeClientService } from '../payments/stripe-client.service';
import type Stripe from 'stripe';
import {
  CreatePlanDto,
  DeletePlanDto,
  UpdatePlanDto,
  UpdatePlanHighlightsDto,
} from './dto/plan.dto';

@Injectable()
export class PlansService {
  private readonly stripe?: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboardCache: AdminDashboardCacheService,
    stripeClient?: StripeClientService,
  ) {
    this.stripe = stripeClient?.client;
  }

  async create(input: CreatePlanDto, actor: AuthenticatedUser, context: AuditRequestContext) {
    if (input.isPublic || input.isAvailable || input.isFeatured) {
      throw new BadRequestException(
        'Create the plan as a draft, add an active coverage rule, and then publish it.',
      );
    }
    const data: Prisma.InternetPlanCreateInput = {
      ...input,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      highlights: this.normalizeHighlights(input.highlights ?? []),
      isPublic: false,
      isAvailable: false,
      isFeatured: false,
    };
    await this.assertUniqueName(data.name);
    const plan = await this.prisma
      .$transaction(async (transaction) => {
        const created = await transaction.internetPlan.create({ data });
        await this.audit(transaction, actor, 'INTERNET_PLAN_CREATED', created.id, {
          after: this.snapshot(created),
          ...context,
        });
        return created;
      })
      .catch((error: unknown) => this.mapWriteError(error));
    await this.dashboardCache.invalidate();
    return plan;
  }

  findActive() {
    return this.prisma.internetPlan.findMany({
      where: { isActive: true, isPublic: true, isAvailable: true },
      orderBy: [{ tierRank: 'asc' }, { monthlyCents: 'asc' }, { id: 'asc' }],
    });
  }

  findAll() {
    return this.prisma.internetPlan.findMany({
      orderBy: [{ isActive: 'desc' }, { tierRank: 'asc' }, { monthlyCents: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.internetPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Internet plan not found.');
    return plan;
  }

  async update(
    id: string,
    input: UpdatePlanDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ) {
    const { expectedUpdatedAt, ...requestedChanges } = input;
    if (requestedChanges.name) await this.assertUniqueName(requestedChanges.name.trim(), id);

    const plan = await this.prisma
      .$transaction(async (transaction) => {
        const current = await transaction.internetPlan.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Internet plan not found.');

        const changes = Object.fromEntries(
          Object.entries({
            ...requestedChanges,
            ...(requestedChanges.name === undefined ? {} : { name: requestedChanges.name.trim() }),
            ...(requestedChanges.description === undefined
              ? {}
              : { description: requestedChanges.description?.trim() || null }),
            ...(requestedChanges.highlights === undefined
              ? {}
              : { highlights: this.normalizeHighlights(requestedChanges.highlights) }),
          }).filter(([, value]) => value !== undefined),
        ) as Prisma.InternetPlanUpdateManyMutationInput;
        const merged = this.enforceLifecycle(current, changes);
        if (this.isPublished(merged)) {
          if (!merged.stripePriceId) {
            throw new BadRequestException(
              'Add the recurring Stripe Price ID before publishing this plan.',
            );
          }
          await this.assertStripePriceMatchesPlan(merged);
          const activeRules = await transaction.planCoverageRule.count({
            where: {
              planId: id,
              isActive: true,
              OR: [{ maximumSpeedMbps: null }, { maximumSpeedMbps: { gte: merged.downloadMbps } }],
            },
          });
          if (!activeRules) {
            throw new BadRequestException(
              'Add at least one active coverage rule before publishing this plan.',
            );
          }
        }

        const updated = await transaction.internetPlan.updateMany({
          where: { id, updatedAt: new Date(expectedUpdatedAt) },
          data: changes,
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'This plan changed after you opened it. Reload the plans and try again.',
          );
        }
        const result = await transaction.internetPlan.findUniqueOrThrow({ where: { id } });
        await this.audit(transaction, actor, this.updateAction(current, result), id, {
          before: this.snapshot(current),
          after: this.snapshot(result),
          ...context,
        });
        return result;
      })
      .catch((error: unknown) => this.mapWriteError(error));
    await this.dashboardCache.invalidate();
    return plan;
  }

  updateHighlights(
    id: string,
    input: UpdatePlanHighlightsDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ) {
    return this.update(
      id,
      { expectedUpdatedAt: input.expectedUpdatedAt, highlights: input.highlights },
      actor,
      context,
    );
  }

  async remove(
    id: string,
    input: DeletePlanDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ) {
    const plan = await this.prisma
      .$transaction(async (transaction) => {
        const current = await transaction.internetPlan.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Internet plan not found.');
        if (this.isPublished(current) || current.isActive) {
          throw new ConflictException('Deactivate the plan before deleting it.');
        }
        const deleted = await transaction.internetPlan.deleteMany({
          where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
        });
        if (deleted.count !== 1) {
          throw new ConflictException(
            'This plan changed after you opened it. Reload the plans and try again.',
          );
        }
        await this.audit(transaction, actor, 'INTERNET_PLAN_DELETED', id, {
          before: this.snapshot(current),
          ...context,
        });
        return current;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          throw new ConflictException(
            'A plan with coverage, subscription, purchase, or change history cannot be deleted. Keep it deactivated instead.',
          );
        }
        return this.mapWriteError(error);
      });
    await this.dashboardCache.invalidate();
    return plan;
  }

  private enforceLifecycle(
    current: InternetPlan,
    changes: Prisma.InternetPlanUpdateManyMutationInput,
  ): InternetPlan {
    if (changes.isActive === false) {
      changes.isPublic = false;
      changes.isAvailable = false;
      changes.isFeatured = false;
    }
    if (changes.isPublic === false) {
      changes.isAvailable = false;
      changes.isFeatured = false;
    }
    if (changes.isAvailable === false) changes.isFeatured = false;
    const merged = { ...current, ...changes } as InternetPlan;
    if (merged.isAvailable && !merged.isPublic) {
      throw new BadRequestException('An orderable plan must also be publicly visible.');
    }
    if ((merged.isPublic || merged.isAvailable || merged.isFeatured) && !merged.isActive) {
      throw new BadRequestException('Activate the plan before publishing or featuring it.');
    }
    if (merged.isFeatured && !this.isPublished(merged)) {
      throw new BadRequestException('Only a published and orderable plan can be featured.');
    }
    return merged;
  }

  private isPublished(plan: Pick<InternetPlan, 'isActive' | 'isPublic' | 'isAvailable'>) {
    return plan.isActive && plan.isPublic && plan.isAvailable;
  }

  private normalizeHighlights(highlights: string[]) {
    return [...new Set(highlights.map((highlight) => highlight.trim()).filter(Boolean))];
  }

  private async assertStripePriceMatchesPlan(plan: InternetPlan): Promise<void> {
    if (!plan.stripePriceId) return;
    if (!this.stripe) return;
    let price: Stripe.Price;
    try {
      price = await this.stripe.prices.retrieve(plan.stripePriceId);
    } catch {
      throw new BadRequestException('The configured Stripe Price could not be found.');
    }
    if (
      !price.active ||
      price.currency.toUpperCase() !== 'AUD' ||
      price.unit_amount !== plan.monthlyCents ||
      price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1
    ) {
      throw new BadRequestException(
        'The Stripe Price must be active, monthly, in AUD, and match the plan price exactly.',
      );
    }
  }

  private async assertUniqueName(name: string, excludingId?: string) {
    const existing = await this.prisma.internetPlan.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A plan with this name already exists.');
  }

  private updateAction(before: InternetPlan, after: InternetPlan) {
    if (before.isActive && !after.isActive) return 'INTERNET_PLAN_DEACTIVATED';
    if (!before.isActive && after.isActive) return 'INTERNET_PLAN_ACTIVATED';
    if (!this.isPublished(before) && this.isPublished(after)) return 'INTERNET_PLAN_PUBLISHED';
    if (before.isAvailable && !after.isAvailable) return 'INTERNET_PLAN_ORDERING_PAUSED';
    if (before.highlights.join('\n') !== after.highlights.join('\n')) {
      return 'INTERNET_PLAN_HIGHLIGHTS_UPDATED';
    }
    return 'INTERNET_PLAN_UPDATED';
  }

  private snapshot(plan: InternetPlan): Prisma.InputJsonObject {
    return {
      name: plan.name,
      description: plan.description,
      highlights: plan.highlights,
      downloadMbps: plan.downloadMbps,
      uploadMbps: plan.uploadMbps,
      monthlyCents: plan.monthlyCents,
      stripePriceId: plan.stripePriceId,
      isActive: plan.isActive,
      isPublic: plan.isPublic,
      isAvailable: plan.isAvailable,
      isFeatured: plan.isFeatured,
      tierRank: plan.tierRank,
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  private audit(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return transaction.auditLog.create({
      data: { actorUserId: actor.id, action, entityType: 'InternetPlan', entityId, metadata },
    });
  }

  private mapWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A plan with this name already exists.');
    }
    throw error;
  }
}
