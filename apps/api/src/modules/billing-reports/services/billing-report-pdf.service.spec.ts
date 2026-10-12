import 'reflect-metadata';
import PDFDocument from 'pdfkit';

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

  describe('revenue trend chart', () => {
    afterEach(() => jest.restoreAllMocks());

    function chart(rows: ReportRow[]) {
      const document = new PDFDocument();
      document.on('data', () => undefined);
      const lineTo = jest.spyOn(document, 'lineTo');
      const moveTo = jest.spyOn(document, 'moveTo');
      const text = jest.spyOn(document, 'text');
      const circle = jest.spyOn(document, 'circle');
      const renderer = service as unknown as {
        revenueChart(
          document: PDFKit.PDFDocument,
          rows: ReportRow[],
          x: number,
          y: number,
          width: number,
          height: number,
        ): void;
      };
      renderer.revenueChart(document, rows, 40, 465, 515, 150);
      document.end();
      return { lineTo, moveTo, text, circle };
    }

    it.each([
      ['mixed collections and refunds', [7900, -30000, 15800]],
      ['refund-only period', [-7647, -10000, -5000]],
    ])('keeps every series point inside the chart for a %s', (_, amounts) => {
      const drawing = chart(
        amounts.map((amount, index) => ({
          period: `2026-10-${String(index + 1).padStart(2, '0')}`,
          grossBilledCents: index === 0 ? 7900 : 0,
          netCashCollectedCents: amount,
        })),
      );
      const points = [...drawing.moveTo.mock.calls, ...drawing.lineTo.mock.calls];
      expect(points.length).toBeGreaterThan(0);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(555);
        expect(y).toBeGreaterThanOrEqual(465);
        expect(y).toBeLessThanOrEqual(615);
      }
      const labels = drawing.text.mock.calls.map(([value]) => String(value));
      expect(labels.some((value) => value.startsWith('-$'))).toBe(true);
      expect(labels).toContain('$0');
    });

    it('draws visible data points for a single-day selection', () => {
      const drawing = chart([
        { period: '2026-10-11', grossBilledCents: 7900, netCashCollectedCents: -7647 },
      ]);
      const points = drawing.circle.mock.calls.filter(([, y]) => y >= 485);
      expect(points).toHaveLength(2);
      expect(points.every(([, y, radius]) => y <= 615 && radius > 0)).toBe(true);
    });

    it('uses distinct, accurate currency ticks for an all-zero period', () => {
      const drawing = chart([
        { period: '2026-10-11', grossBilledCents: 0, netCashCollectedCents: 0 },
      ]);
      const labels = drawing.text.mock.calls
        .map(([value]) => String(value))
        .filter((value) => value.startsWith('$'));
      expect(labels).toContain('$0.00');
      expect(labels).toContain('$1.00');
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('spaces date labels apart across a dense reporting period, including its last day', () => {
      const rows = Array.from({ length: 32 }, (_, index) => ({
        period: new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10),
        grossBilledCents: 7900,
        netCashCollectedCents: index === 15 ? -7647 : 0,
      }));
      const drawing = chart(rows);
      const labels = drawing.text.mock.calls.filter(([value]) => /^2026-/.test(String(value)));
      expect(labels[0][0]).toBe(rows[0].period);
      expect(labels[labels.length - 1][0]).toBe(rows[31].period);
      for (let index = 1; index < labels.length; index += 1) {
        const previous = labels[index - 1];
        expect(
          Number(previous[1]) + Number((previous[3] as PDFKit.Mixins.TextOptions).width),
        ).toBeLessThanOrEqual(Number(labels[index][1]));
      }
    });

    it('generates the complete PDF when refunds exceed collections', async () => {
      const report = input([]);
      report.revenue = {
        trend: [{ period: '2026-08-01', grossBilledCents: 7900, netCashCollectedCents: -30000 }],
      };
      const buffer = await service.render(report);
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pageCount(buffer)).toBe(3);
    });
  });
});
