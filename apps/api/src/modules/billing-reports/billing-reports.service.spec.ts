import { InvoiceStatus, PaymentStatus, Role } from '@prisma/client';

import { BillingReportsService } from './billing-reports.service';

describe('BillingReportsService', () => {
  it('calculates deterministic summary totals from stored cents', async () => {
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            subtotalCents: 9_000,
            taxCents: 1_000,
            totalCents: 10_000,
            status: InvoiceStatus.ISSUED,
            payments: [{ amountCents: 6_000, status: PaymentStatus.SUCCEEDED }],
          },
        ]),
        count: jest
          .fn()
          .mockImplementation(({ where }: { where: { status?: InvoiceStatus } }) =>
            Promise.resolve(
              where.status === InvoiceStatus.PAID
                ? 0
                : where.status === InvoiceStatus.OVERDUE
                  ? 0
                  : 1,
            ),
          ),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 6_000 } }),
        count: jest.fn().mockResolvedValue(0),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { refundAmountCents: 500 } }),
      },
      subscription: { count: jest.fn().mockResolvedValue(2) },
    };
    const service = new BillingReportsService(prisma as never);
    const result = await service.summary(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      { id: 'admin', email: 'admin@example.com', role: Role.ADMIN },
    );
    expect(result).toMatchObject({
      totalInvoices: 1,
      grossAmountCents: 10_000,
      paymentsReceivedCents: 6_000,
      outstandingBalanceCents: 4_000,
      refundAmountCents: 500,
      gstCollectedCents: 1_000,
      netRevenueCents: 5_500,
      activeSubscriptions: 2,
    });
  });

  it('rejects non-administrator access', () => {
    const service = new BillingReportsService({} as never);
    expect(() =>
      service.assertCanView({ id: 'customer', email: 'customer@example.com', role: Role.CUSTOMER }),
    ).toThrow('administrator access');
  });
});
