import { PlansService } from './plans.service';
import type { PrismaService } from '../../database/prisma.service';
import type { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';

describe('PlansService', () => {
  const dashboardCache = { invalidate: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only active plans to the public catalog', async () => {
    const prisma = { internetPlan: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PlansService(
      prisma as unknown as PrismaService,
      dashboardCache as unknown as AdminDashboardCacheService,
    );
    await service.findActive();
    expect(prisma.internetPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true, isPublic: true, isAvailable: true },
      orderBy: [{ tierRank: 'asc' }, { monthlyCents: 'asc' }],
    });
  });

  it('updates only the customer-facing plan highlights', async () => {
    const planId = '123e4567-e89b-12d3-a456-426614174000';
    const highlights = ['  HD streaming  ', '', 'Working from home'];
    const normalizedHighlights = ['HD streaming', 'Working from home'];
    const prisma = {
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue({ id: planId }),
        update: jest.fn().mockResolvedValue({ id: planId, highlights: normalizedHighlights }),
      },
    };
    const service = new PlansService(
      prisma as unknown as PrismaService,
      dashboardCache as unknown as AdminDashboardCacheService,
    );

    await service.updateHighlights(planId, highlights);

    expect(prisma.internetPlan.update).toHaveBeenCalledWith({
      where: { id: planId },
      data: { highlights: normalizedHighlights },
    });
    expect(dashboardCache.invalidate).toHaveBeenCalledTimes(1);
  });
});
