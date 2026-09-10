import { ReceivablesReportService } from './receivables-report.service';

describe('ReceivablesReportService', () => {
  it('ages remaining balances from due date at period end', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            invoiceNumber: 'INV-1',
            customer: 'A Customer',
            customerNumber: 'CUS-1',
            customerId: 'customer-1',
            totalCents: 10_000,
            paidCents: 4_000,
            outstandingAmountCents: 6_000,
            dueDate: new Date('2026-07-15T00:00:00.000Z'),
            status: 'OVERDUE',
            ageingBucket: '31-60',
            daysOverdue: 55,
            totalRows: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            ageingBucket: '31-60',
            invoiceCount: 1,
            customerCount: 1,
            outstandingAmountCents: 6_000n,
          },
          {
            ageingBucket: '__TOTAL__',
            invoiceCount: 1,
            customerCount: 1,
            outstandingAmountCents: 6_000n,
          },
        ])
        .mockResolvedValueOnce([{ total: 1 }]),
    };
    const service = new ReceivablesReportService(prisma as never);
    const result = await service.report(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-09T00:00:00.000Z'),
        previousFrom: new Date('2026-08-24T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date(),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-08',
      },
    );
    expect(result.data[0]).toMatchObject({
      outstandingAmountCents: 6_000,
      ageingBucket: '31-60',
      daysOverdue: 55,
    });
    expect(result.buckets.find((bucket) => bucket.key === '31-60')).toMatchObject({
      invoiceCount: 1,
      customerCount: 1,
      outstandingAmountCents: 6_000,
    });
  });
});
