import { AccessTechnology, Role } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import type { AddressSelectionService } from './address-selection.service';
import { CoverageManagementService } from './coverage-management.service';

const actor: AuthenticatedUser = {
  id: 'admin-id',
  email: 'admin@example.test',
  role: Role.ADMIN,
  roles: [Role.ADMIN],
};

const timestamp = new Date('2026-09-13T12:00:00.000Z');
const rule = {
  id: 'rule-id',
  planId: 'plan-id',
  technology: AccessTechnology.FTTP,
  minimumSpeedMbps: null,
  maximumSpeedMbps: 100,
  operatingRegionId: null,
  postcode: null,
  scopeKey: 'region:*:postcode:*',
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('CoverageManagementService', () => {
  it('pauses ordering when a coverage edit removes the last compatible rule', async () => {
    const updatedRule = { ...rule, maximumSpeedMbps: 50 };
    const transaction = {
      planCoverageRule: {
        update: jest.fn().mockResolvedValue(updatedRule),
        count: jest.fn().mockResolvedValue(0),
      },
      internetPlan: {
        findUnique: jest.fn().mockResolvedValue({
          id: rule.planId,
          downloadMbps: 100,
          isActive: true,
          isPublic: true,
          isAvailable: true,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      planCoverageRule: { findUnique: jest.fn().mockResolvedValue(rule) },
      internetPlan: { findUnique: jest.fn().mockResolvedValue({ id: rule.planId }) },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };
    const dashboardCache = { invalidate: jest.fn().mockResolvedValue(true) };
    const service = new CoverageManagementService(
      prisma as unknown as PrismaService,
      {} as AddressSelectionService,
      dashboardCache as unknown as AdminDashboardCacheService,
    );

    await service.updatePlanRule(rule.id, { maximumSpeedMbps: 50 }, actor);

    expect(transaction.internetPlan.update).toHaveBeenCalledWith({
      where: { id: rule.planId },
      data: { isAvailable: false, isFeatured: false },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'INTERNET_PLAN_ORDERING_PAUSED',
        entityType: 'InternetPlan',
        entityId: rule.planId,
      }),
    });
    expect(dashboardCache.invalidate).toHaveBeenCalledTimes(1);
  });
});
