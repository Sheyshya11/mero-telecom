import 'reflect-metadata';

import type { BillingReportExportDocument, ReportRow } from '../billing-report-export.types';
import { BillingReportType } from '../dto/billing-report-query.dto';
import { BillingReportPdfService } from './billing-report-pdf.service';

describe('BillingReportPdfService', () => {
  const service = new BillingReportPdfService();

  function invoice(index: number): ReportRow {
    return {
      invoiceNumber: `INV-2026-${String(index + 1).padStart(6, '0')}`,
      customer:
        index === 0
          ? 'A Customer With An Intentionally Long Name That Must Wrap Safely'
          : `Development Customer ${index + 1}`,
      plan: index % 2 === 0 ? 'NBN Home Fast 100/20' : 'NBN Essential 50/20',
      issueDate: new Date('2026-08-01T00:00:00.000Z'),
      dueDate: new Date('2026-08-15T00:00:00.000Z'),
      totalCents: 9_900 + index,
      amountPaidCents: index % 3 === 0 ? 9_900 + index : 0,
      amountDueCents: index % 3 === 0 ? 0 : 9_900 + index,
      status: index % 3 === 0 ? 'PAID' : index % 3 === 1 ? 'ISSUED' : 'OVERDUE',
    };
  }

  function input(rows: ReportRow[]): BillingReportExportDocument {
    return {
      metadata: {
        organisation: 'Mero Telecom',
        reportType: BillingReportType.INVOICES,
        reportName: 'Invoice Report',
        reportId: 'MT-INVOICES-20260909T092500Z',
        from: '2026-07-31T14:30:00.000Z',
        to: '2026-08-31T14:30:00.000Z',
        fromLocalDate: '2026-08-01',
        toLocalDate: '2026-08-31',
        timezone: 'Australia/Adelaide',
        generatedAt: '2026-09-09T00:00:00.000Z',
        generatedBy: 'admin@merotelecom.test',
        currency: 'AUD',
        activeFilters: { preset: 'last_month' },
      },
      report: { data: rows },
      rows,
      overview: {
        metrics: {
          grossBilled: { valueCents: 4_862_040 },
          paymentsReceived: { valueCents: 4_598_020 },
          outstanding: { valueCents: 264_020 },
          netCashCollected: { valueCents: 4_555_020 },
          overdueBalance: { valueCents: 152_020 },
          refundsPaid: { valueCents: 43_000 },
        },
        paymentHealth: {
          successfulPaymentCount: 312,
          failedPaymentCount: 9,
          paymentSuccessRate: 97.2,
          averagePaymentValueCents: 14_737,
          refundCount: 4,
        },
      },
      revenue: {
        trend: [
          { period: '2026-08-01', grossBilledCents: 1_200_000, netCashCollectedCents: 1_080_000 },
          { period: '2026-08-08', grossBilledCents: 1_150_000, netCashCollectedCents: 1_100_000 },
          { period: '2026-08-15', grossBilledCents: 1_300_000, netCashCollectedCents: 1_210_000 },
          { period: '2026-08-22', grossBilledCents: 1_212_040, netCashCollectedCents: 1_165_020 },
        ],
      },
      plans: {
        data: [
          {
            planName: 'NBN Home Fast 100/20',
            activeServices: 110,
            grossBilledCents: 1_842_000,
            collectedCents: 1_790_000,
          },
          {
            planName: 'NBN Essential 50/20',
            activeServices: 94,
            grossBilledCents: 1_385_000,
            collectedCents: 1_330_000,
          },
          {
            planName: 'NBN Ultrafast 1000/50',
            activeServices: 42,
            grossBilledCents: 980_000,
            collectedCents: 945_000,
          },
        ],
      },
    };
  }

  function pageCount(buffer: Buffer): number {
    return buffer.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
  }

  it.each([10, 100, 550])(
    'generates a valid, paginated report for %i records',
    async (count) => {
      const buffer = await service.render(
        input(Array.from({ length: count }, (_, index) => invoice(index))),
      );

      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(8_000);
      expect(pageCount(buffer)).toBeGreaterThanOrEqual(3);
      if (count === 550) expect(pageCount(buffer)).toBeGreaterThan(15);
    },
    30_000,
  );

  it('generates a complete professional report for an empty dataset', async () => {
    const buffer = await service.render(input([]));

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(buffer)).toBe(3);
  });
});
