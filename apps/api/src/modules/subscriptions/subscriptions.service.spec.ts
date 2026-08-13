import { BadRequestException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

const dashboardCache = { invalidate: jest.fn().mockResolvedValue(true) };

describe('SubscriptionsService', () => {
  it('rejects an invalid lifecycle transition before updating the database', async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          customerId: 'customer-id',
          planId: 'plan-id',
          status: SubscriptionStatus.CANCELLED,
        }),
        update: jest.fn(),
      },
    };
    const service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    await expect(
      service.update('subscription-id', { status: SubscriptionStatus.ACTIVE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('rejects an end date before the effective start date', async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          customerId: 'customer-id',
          planId: 'plan-id',
          status: SubscriptionStatus.PENDING,
          startDate: new Date('2026-08-10'),
          endDate: null,
        }),
        update: jest.fn(),
      },
    };
    const service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    await expect(
      service.update('subscription-id', { endDate: '2026-08-09' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('checks a changed start date against the stored end date', async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          customerId: 'customer-id',
          planId: 'plan-id',
          status: SubscriptionStatus.PENDING,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-10'),
        }),
        update: jest.fn(),
      },
    };
    const service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      dashboardCache as never,
    );

    await expect(
      service.update('subscription-id', { startDate: '2026-08-11' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});
