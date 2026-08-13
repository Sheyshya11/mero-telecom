import { buildInvoiceTrend, startOfTrendPeriod } from './dashboard.utils';

describe('dashboard trend helpers', () => {
  it('creates six complete monthly buckets and sums matching invoices', () => {
    const endDate = new Date('2026-08-12T00:00:00.000Z');
    expect(startOfTrendPeriod(endDate).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(
      buildInvoiceTrend(
        [{ issueDate: new Date('2026-07-01T00:00:00.000Z'), totalCents: 7900 }],
        endDate,
      ),
    ).toEqual([
      { month: '2026-03', label: 'Mar', totalCents: 0, count: 0 },
      { month: '2026-04', label: 'Apr', totalCents: 0, count: 0 },
      { month: '2026-05', label: 'May', totalCents: 0, count: 0 },
      { month: '2026-06', label: 'Jun', totalCents: 0, count: 0 },
      { month: '2026-07', label: 'Jul', totalCents: 7900, count: 1 },
      { month: '2026-08', label: 'Aug', totalCents: 0, count: 0 },
    ]);
  });
});
