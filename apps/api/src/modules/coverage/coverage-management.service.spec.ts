import {
  AccessTechnology,
  OperatingRegionStatus,
  PostcodeCoverageStatus,
  Role,
} from '@prisma/client';

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

const region = {
  id: 'region-id',
  countryCode: 'AU',
  stateCode: 'SA',
  name: 'South Australia',
  status: OperatingRegionStatus.ACTIVE,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const postcodeRecord = {
  id: 'postcode-id',
  operatingRegionId: region.id,
  postcode: '5000',
  status: PostcodeCoverageStatus.AVAILABLE,
  technology: AccessTechnology.FTTP,
  maximumSpeedMbps: 100,
  availabilityDate: null,
  isActive: true,
  adminNotes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function serviceWith(prisma: object) {
  return new CoverageManagementService(
    prisma as PrismaService,
    {} as AddressSelectionService,
    { invalidate: jest.fn() } as unknown as AdminDashboardCacheService,
  );
}

describe('CoverageManagementService', () => {
  it('creates a valid postcode coverage record', async () => {
    const transaction = {
      postcodeCoverage: { create: jest.fn().mockResolvedValue(postcodeRecord) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
      postcodeCoverage: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    const result = await serviceWith(prisma).createPostcode(
      {
        operatingRegionId: region.id,
        postcode: '5000',
        status: PostcodeCoverageStatus.AVAILABLE,
        technology: AccessTechnology.FTTP,
        maximumSpeedMbps: 100,
      },
      actor,
    );

    expect(result).toEqual(postcodeRecord);
    expect(transaction.postcodeCoverage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ postcode: '5000', operatingRegionId: region.id }),
    });
  });

  it('returns a friendly error for a duplicate postcode in the same region', async () => {
    const prisma = {
      operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
      postcodeCoverage: { findFirst: jest.fn().mockResolvedValue({ id: 'duplicate-id' }) },
    };

    await expect(
      serviceWith(prisma).createPostcode(
        {
          operatingRegionId: region.id,
          postcode: '5000',
          status: PostcodeCoverageStatus.AVAILABLE,
          technology: AccessTechnology.FTTP,
          maximumSpeedMbps: 100,
        },
        actor,
      ),
    ).rejects.toThrow('Postcode 5000 already exists in South Australia.');
  });

  it('rejects a postcode that does not belong to the selected region', async () => {
    const prisma = {
      operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
      postcodeCoverage: { findFirst: jest.fn() },
    };

    await expect(
      serviceWith(prisma).createPostcode(
        {
          operatingRegionId: region.id,
          postcode: '2000',
          status: PostcodeCoverageStatus.AVAILABLE,
          technology: AccessTechnology.FTTP,
          maximumSpeedMbps: 100,
        },
        actor,
      ),
    ).rejects.toThrow('Postcode 2000 does not belong to South Australia.');
    expect(prisma.postcodeCoverage.findFirst).not.toHaveBeenCalled();
  });

  it('edits a postcode without treating the current record as a duplicate', async () => {
    const updated = { ...postcodeRecord, postcode: '5006' };
    const transaction = {
      postcodeCoverage: { update: jest.fn().mockResolvedValue(updated) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
      postcodeCoverage: {
        findUnique: jest.fn().mockResolvedValue(postcodeRecord),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await serviceWith(prisma).updatePostcode(postcodeRecord.id, { postcode: '5006' }, actor);

    expect(prisma.postcodeCoverage.findFirst).toHaveBeenCalledWith({
      where: {
        operatingRegionId: region.id,
        postcode: '5006',
        id: { not: postcodeRecord.id },
      },
      select: { id: true },
    });
    expect(transaction.postcodeCoverage.update).toHaveBeenCalledWith({
      where: { id: postcodeRecord.id },
      data: { postcode: '5006', availabilityDate: undefined },
    });
  });

  it('enables and disables a postcode record', async () => {
    const transaction = {
      postcodeCoverage: {
        update: jest
          .fn()
          .mockResolvedValueOnce({ ...postcodeRecord, isActive: false })
          .mockResolvedValueOnce(postcodeRecord),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
      postcodeCoverage: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(postcodeRecord)
          .mockResolvedValueOnce({ ...postcodeRecord, isActive: false }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };
    const service = serviceWith(prisma);

    await service.updatePostcode(postcodeRecord.id, { isActive: false }, actor);
    await service.updatePostcode(postcodeRecord.id, { isActive: true }, actor);

    expect(transaction.postcodeCoverage.update).toHaveBeenNthCalledWith(1, {
      where: { id: postcodeRecord.id },
      data: { isActive: false, availabilityDate: undefined },
    });
    expect(transaction.postcodeCoverage.update).toHaveBeenNthCalledWith(2, {
      where: { id: postcodeRecord.id },
      data: { isActive: true, availabilityDate: undefined },
    });
  });

  it('enables and disables a whole region', async () => {
    const transaction = {
      operatingRegion: {
        update: jest
          .fn()
          .mockResolvedValueOnce({ ...region, status: OperatingRegionStatus.DISABLED })
          .mockResolvedValueOnce(region),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      operatingRegion: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(region)
          .mockResolvedValueOnce({ ...region, status: OperatingRegionStatus.DISABLED }),
      },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };
    const service = serviceWith(prisma);

    await service.updateRegion(region.id, { status: OperatingRegionStatus.DISABLED }, actor);
    await service.updateRegion(region.id, { status: OperatingRegionStatus.ACTIVE }, actor);

    expect(transaction.operatingRegion.update).toHaveBeenNthCalledWith(1, {
      where: { id: region.id },
      data: { status: OperatingRegionStatus.DISABLED },
    });
    expect(transaction.operatingRegion.update).toHaveBeenNthCalledWith(2, {
      where: { id: region.id },
      data: { status: OperatingRegionStatus.ACTIVE },
    });
  });

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
