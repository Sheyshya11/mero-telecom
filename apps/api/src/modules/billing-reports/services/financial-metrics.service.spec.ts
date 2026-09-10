import { PaymentStatus, RefundStatus } from '@prisma/client';

import { BillingReportCalculationsService } from './billing-report-calculations.service';
import { FinancialMetricsService } from './financial-metrics.service';

describe('FinancialMetricsService', () => {
  it('reports current billing separately from a refund for an earlier payment', async () => {
    const invoiceFindMany = jest
      .fn()
      .mockResolvedValueOnce([{ totalCents: 9_900, taxCents: 900 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          totalCents: 9_900,
          dueDate: new Date('2026-09-15T00:00:00.000Z'),
          customerId: 'customer-1',
          paidAt: null,
          payments: [],
        },
      ])
      .mockResolvedValueOnce([]);
    const prisma = {
      invoice: { findMany: invoiceFindMany, count: jest.fn().mockResolvedValue(0) },
      payment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      refund: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              refundAmountCents: 5_530,
              invoice: { taxCents: 900, totalCents: 9_900 },
            },
          ])
          .mockResolvedValueOnce([]),
      },
      planChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FinancialMetricsService(
      prisma as never,
      new BillingReportCalculationsService(),
    );
    const result = await service.overview(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-10-01T00:00:00.000Z'),
        previousFrom: new Date('2026-08-01T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date('2026-09-20T00:00:00.000Z'),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-30',
      },
    );
    expect(result).toMatchObject({
      grossAmountCents: 9_900,
      paymentsReceivedCents: 0,
      outstandingBalanceCents: 9_900,
      refundAmountCents: 5_530,
      netCashCollectedCents: -5_530,
      tax: { gstBilledCents: 900 },
    });
  });

  it('does not report a legacy invoice as receivable when paidAt proves it was settled', async () => {
    const prisma = {
      invoice: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              totalCents: 6_900,
              dueDate: new Date('2026-09-15T00:00:00.000Z'),
              customerId: 'customer-1',
              paidAt: new Date('2026-09-08T00:00:00.000Z'),
              payments: [],
            },
          ])
          .mockResolvedValueOnce([]),
        count: jest.fn().mockResolvedValue(0),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      refund: { findMany: jest.fn().mockResolvedValue([]) },
      planChangeRequest: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FinancialMetricsService(
      prisma as never,
      new BillingReportCalculationsService(),
    );
    const result = await service.overview(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-10-01T00:00:00.000Z'),
        previousFrom: new Date('2026-08-01T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date('2026-09-20T00:00:00.000Z'),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-30',
      },
    );

    expect(result.outstandingBalanceCents).toBe(0);
  });

  it('uses paidAt for successful payments and processedAt for refunds', () => {
    const service = new FinancialMetricsService(
      {} as never,
      new BillingReportCalculationsService(),
    );
    const query = { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' as const };
    const range = {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(service.paymentWhere(query, range, true)).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            paidAt: { gte: range.from, lt: range.to },
            status: {
              in: [
                PaymentStatus.SUCCEEDED,
                PaymentStatus.PARTIALLY_REFUNDED,
                PaymentStatus.REFUNDED,
              ],
            },
          }),
        ]),
      }),
    );
    expect(service.refundWhere(query, range)).toEqual(
      expect.objectContaining({
        AND: expect.arrayContaining([
          {
            status: RefundStatus.SUCCEEDED,
            processedAt: { gte: range.from, lt: range.to },
          },
        ]),
      }),
    );
  });
});
