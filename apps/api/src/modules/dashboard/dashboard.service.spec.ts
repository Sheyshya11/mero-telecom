import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { DashboardService } from './dashboard.service';
import type { AdminDashboardSummary } from './dashboard.types';

const cachedSummary: AdminDashboardSummary = {
  metrics: {
    customerCount: 2,
    activeSubscriptions: 1,
    monthlyRecurringRevenueCents: 6900,
    outstandingInvoiceCents: 6900,
    overdueInvoiceCount: 0,
  },
  invoiceTrend: [],
  subscriptionsByStatus: [{ status: SubscriptionStatus.ACTIVE, count: 1 }],
  recentInvoices: [],
};

function createPrisma() {
  return {
    customer: { count: jest.fn().mockResolvedValue(2) },
    subscription: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([{ plan: { monthlyCents: 6900 } }]),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ status: SubscriptionStatus.ACTIVE, _count: { _all: 1 } }]),
    },
    invoice: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 6900 } }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { issueDate: new Date('2026-08-01T00:00:00.000Z'), totalCents: 6900 },
        ])
        .mockResolvedValueOnce([
          {
            id: 'invoice-id',
            invoiceNumber: 'INV-2026-000002',
            issueDate: new Date('2026-08-01T00:00:00.000Z'),
            totalCents: 6900,
            status: InvoiceStatus.ISSUED,
            customer: { firstName: 'Anika', lastName: 'Singh' },
          },
        ]),
    },
  };
}

describe('DashboardService admin cache', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('queries PostgreSQL on a miss and caches the completed summary', async () => {
    const prisma = createPrisma();
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      cache as unknown as AdminDashboardCacheService,
    );

    const summary = await service.getAdminSummary();

    expect(summary.metrics.customerCount).toBe(2);
    expect(summary.recentInvoices[0]?.issueDate).toBe('2026-08-01T00:00:00.000Z');
    expect(prisma.customer.count).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(summary);
  });

  it('returns a cache hit without issuing dashboard database queries', async () => {
    const prisma = createPrisma();
    const cache = {
      get: jest.fn().mockResolvedValue(cachedSummary),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      cache as unknown as AdminDashboardCacheService,
    );

    await expect(service.getAdminSummary()).resolves.toBe(cachedSummary);
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(prisma.subscription.count).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
