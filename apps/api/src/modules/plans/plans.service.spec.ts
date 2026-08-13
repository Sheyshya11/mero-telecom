import { PlansService } from './plans.service';
import type { PrismaService } from '../../database/prisma.service';
describe('PlansService', () => {
  it('returns only active plans to the public catalog', async () => {
    const prisma = { internetPlan: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PlansService(prisma as unknown as PrismaService);
    await service.findActive();
    expect(prisma.internetPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { monthlyCents: 'asc' },
    });
  });
});
