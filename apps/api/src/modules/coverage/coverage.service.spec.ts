import type { PrismaService } from '../../database/prisma.service';
import { CoverageService } from './coverage.service';

describe('CoverageService', () => {
  const plans = [{ id: 'plan-id', name: 'Essential 50', downloadMbps: 50, uploadMbps: 20, monthlyCents: 6900 }];
  const prisma = { internetPlan: { findMany: jest.fn().mockResolvedValue(plans) } };
  const service = new CoverageService(prisma as unknown as PrismaService);

  it('returns active plans for a serviceable Sydney postcode', async () => {
    await expect(service.lookup('2000')).resolves.toEqual(
      expect.objectContaining({ status: 'AVAILABLE', plans, qualificationRequired: true }),
    );
    expect(prisma.internetPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('does not expose plans outside the current footprint', async () => {
    await expect(service.lookup('3000')).resolves.toEqual(
      expect.objectContaining({ status: 'UNAVAILABLE', plans: [] }),
    );
  });
});
