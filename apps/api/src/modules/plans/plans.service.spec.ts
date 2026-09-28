import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { createValidationPipe } from '../../common/pipes/create-validation-pipe';
import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

const actor: AuthenticatedUser = {
  id: 'admin-id',
  email: 'admin@example.test',
  role: Role.ADMIN,
  roles: [Role.ADMIN],
};
const timestamp = new Date('2026-09-13T12:00:00.000Z');
const plan = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Essential 50',
  description: 'Everyday internet',
  highlights: ['HD streaming'],
  downloadMbps: 50,
  uploadMbps: 20,
  monthlyCents: 6900,
  stripePriceId: 'price_test_essential50',
  isActive: true,
  isPublic: false,
  isAvailable: false,
  isFeatured: false,
  tierRank: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const dashboardCache = { invalidate: jest.fn().mockResolvedValue(true) };

function serviceWith(
  transaction: Record<string, unknown>,
  findFirst = jest.fn().mockResolvedValue(null),
) {
  const prisma = {
    internetPlan: { findMany: jest.fn().mockResolvedValue([]), findFirst },
    $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
      operation(transaction),
    ),
  };
  return {
    prisma,
    service: new PlansService(
      prisma as unknown as PrismaService,
      dashboardCache as unknown as AdminDashboardCacheService,
    ),
  };
}

describe('PlansService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only published plans in deterministic order', async () => {
    const prisma = { internetPlan: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PlansService(
      prisma as unknown as PrismaService,
      dashboardCache as unknown as AdminDashboardCacheService,
    );

    await service.findActive();

    expect(prisma.internetPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true, isPublic: true, isAvailable: true },
      orderBy: [{ tierRank: 'asc' }, { monthlyCents: 'asc' }, { id: 'asc' }],
    });
  });

  it('creates plans as audited drafts', async () => {
    const transaction = {
      internetPlan: { create: jest.fn().mockResolvedValue(plan) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transaction);

    await service.create(
      {
        name: '  Essential 50  ',
        description: '  Everyday internet  ',
        highlights: ['  HD streaming  '],
        downloadMbps: 50,
        uploadMbps: 20,
        monthlyCents: 6900,
      },
      actor,
      { requestId: 'request-id' },
    );

    expect(transaction.internetPlan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Essential 50',
        description: 'Everyday internet',
        highlights: ['HD streaming'],
        isPublic: false,
        isAvailable: false,
        isFeatured: false,
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.id,
        action: 'INTERNET_PLAN_CREATED',
        entityType: 'InternetPlan',
      }),
    });
  });

  it('rejects attempts to bypass the draft and coverage workflow on create', async () => {
    const { service, prisma } = serviceWith({});

    await expect(
      service.create(
        {
          name: 'Essential 50',
          downloadMbps: 50,
          uploadMbps: 20,
          monthlyCents: 6900,
          isPublic: true,
        },
        actor,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires active coverage before publishing', async () => {
    const transaction = {
      internetPlan: { findUnique: jest.fn().mockResolvedValue(plan), updateMany: jest.fn() },
      planCoverageRule: { count: jest.fn().mockResolvedValue(0) },
    };
    const { service } = serviceWith(transaction);

    await expect(
      service.update(
        plan.id,
        {
          expectedUpdatedAt: timestamp.toISOString(),
          isPublic: true,
          isAvailable: true,
        },
        actor,
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.internetPlan.updateMany).not.toHaveBeenCalled();
  });

  it('ignores undefined class fields when publishing a transformed HTTP request', async () => {
    const updated = { ...plan, isPublic: true, isAvailable: true };
    const transaction = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue(plan),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      planCoverageRule: { count: jest.fn().mockResolvedValue(1) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transaction);
    const input = await createValidationPipe().transform(
      {
        expectedUpdatedAt: timestamp.toISOString(),
        isPublic: true,
        isAvailable: true,
      },
      { type: 'body', metatype: UpdatePlanDto },
    );

    await expect(service.update(plan.id, input, actor, {})).resolves.toEqual(updated);
    expect(transaction.internetPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isPublic: true, isAvailable: true },
      }),
    );
  });

  it('rejects a stale update instead of overwriting newer plan data', async () => {
    const transaction = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue(plan),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const { service } = serviceWith(transaction);

    await expect(
      service.updateHighlights(
        plan.id,
        { expectedUpdatedAt: timestamp.toISOString(), highlights: ['Working from home'] },
        actor,
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalizes highlights and writes an audit entry', async () => {
    const updated = {
      ...plan,
      highlights: ['HD streaming', 'Working from home'],
      updatedAt: new Date('2026-09-13T12:01:00.000Z'),
    };
    const transaction = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue(plan),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transaction);

    await service.updateHighlights(
      plan.id,
      {
        expectedUpdatedAt: timestamp.toISOString(),
        highlights: ['  HD streaming  ', 'Working from home', 'HD streaming'],
      },
      actor,
      {},
    );

    expect(transaction.internetPlan.updateMany).toHaveBeenCalledWith({
      where: { id: plan.id, updatedAt: timestamp },
      data: { highlights: ['HD streaming', 'Working from home'] },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'INTERNET_PLAN_HIGHLIGHTS_UPDATED' }),
    });
  });

  it('removes the featured flag when ordering is paused', async () => {
    const published = {
      ...plan,
      isPublic: true,
      isAvailable: true,
      isFeatured: true,
    };
    const paused = { ...published, isAvailable: false, isFeatured: false };
    const transaction = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue(published),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(paused),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith(transaction);

    await service.update(
      plan.id,
      { expectedUpdatedAt: timestamp.toISOString(), isAvailable: false },
      actor,
      {},
    );

    expect(transaction.internetPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isAvailable: false, isFeatured: false } }),
    );
  });
});
