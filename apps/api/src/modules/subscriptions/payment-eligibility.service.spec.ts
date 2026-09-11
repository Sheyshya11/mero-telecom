import type { PrismaService } from '../../database/prisma.service';
import { PaymentEligibilityService } from './payment-eligibility.service';

describe('PaymentEligibilityService', () => {
  it.each([
    [0, false],
    [1, true],
    [2, true],
  ])('maps %i blocking invoices to %s', async (count, expected) => {
    const prisma = { invoice: { count: jest.fn().mockResolvedValue(count) } };
    const service = new PaymentEligibilityService(prisma as unknown as PrismaService);
    await expect(service.hasBlockingOutstandingBalance('subscription-id')).resolves.toBe(expected);
  });
});
