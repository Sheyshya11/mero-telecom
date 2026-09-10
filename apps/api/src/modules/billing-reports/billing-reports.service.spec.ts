import { Role } from '@prisma/client';

import { BillingReportsService } from './billing-reports.service';

describe('BillingReportsService', () => {
  const period = {
    from: new Date('2026-08-31T14:30:00.000Z'),
    to: new Date('2026-09-30T14:30:00.000Z'),
    previousFrom: new Date('2026-08-01T14:30:00.000Z'),
    previousTo: new Date('2026-08-31T14:30:00.000Z'),
    timezone: 'Australia/Adelaide',
    generatedAt: new Date('2026-09-08T00:00:00.000Z'),
    fromLocalDate: '2026-09-01',
    toLocalDate: '2026-09-30',
  };

  function service() {
    const periods = {
      resolve: jest.fn().mockReturnValue(period),
      metadata: jest.fn().mockReturnValue({
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        timezone: period.timezone,
        generatedAt: period.generatedAt.toISOString(),
      }),
    };
    const financialMetrics = {
      overview: jest.fn().mockResolvedValue({
        metrics: { grossBilled: { valueCents: 9_900 } },
        grossAmountCents: 9_900,
      }),
    };
    const reconciliation = {
      report: jest.fn().mockResolvedValue({
        summary: { exceptionCount: 2, lastReconciledAt: '2026-09-08T00:00:00.000Z' },
      }),
    };
    const calculations = {
      count: jest.fn((count: number) => ({ count, previousPeriodCount: 0 })),
    };
    return {
      instance: new BillingReportsService(
        {} as never,
        periods as never,
        financialMetrics as never,
        calculations as never,
        {} as never,
        reconciliation as never,
        {} as never,
        {} as never,
      ),
      financialMetrics,
    };
  }

  it('labels period and snapshot metric bases and includes reconciliation exceptions', async () => {
    const { instance, financialMetrics } = service();
    const result = await instance.summary(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      { id: 'admin', email: 'admin@example.com', role: Role.ADMIN },
    );
    expect(financialMetrics.overview).toHaveBeenCalled();
    expect(result).toMatchObject({
      period: { timezone: 'Australia/Adelaide' },
      metricBasis: {
        periodMetrics: expect.arrayContaining(['grossBilled', 'paymentsReceived']),
        snapshotMetrics: expect.arrayContaining(['outstanding', 'mrr']),
      },
      metrics: { unreconciledTransactions: { count: 2 } },
    });
  });

  it('rejects non-administrator access', () => {
    const { instance } = service();
    expect(() =>
      instance.assertCanView({
        id: 'customer',
        email: 'customer@example.com',
        role: Role.CUSTOMER,
      }),
    ).toThrow('administrator access');
  });
});
