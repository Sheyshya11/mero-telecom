import 'reflect-metadata';

import { BillingReportType } from '../dto/billing-report-query.dto';
import { BillingReportCsvService } from './billing-report-csv.service';

describe('BillingReportCsvService', () => {
  const service = new BillingReportCsvService();

  it('creates a UTF-8 Excel-friendly invoice CSV with stable columns and typed values', () => {
    const csv = service
      .render(
        BillingReportType.INVOICES,
        [
          {
            invoiceNumber: 'INV-2026-000042',
            customer: 'Shrestha, Subham',
            customerEmail: '=unsafe@example.test',
            plan: 'NBN "Home"\n100/20',
            billingPeriod: '2026-08-01',
            issueDate: new Date('2026-08-01T00:00:00.000Z'),
            dueDate: new Date('2026-08-15T00:00:00.000Z'),
            subtotalCents: 9_000,
            gstCents: 900,
            totalCents: 9_900,
            amountPaidCents: 4_950,
            amountDueCents: 4_950,
            status: 'PARTIALLY_PAID',
            paidDate: null,
          },
        ],
        'Australia/Adelaide',
      )
      .toString('utf8');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Invoice Number,Customer,Customer Email,Plan');
    expect(csv).toContain('"Shrestha, Subham"');
    expect(csv).toContain("'=unsafe@example.test");
    expect(csv).toContain('"NBN ""Home""\n100/20"');
    expect(csv).toContain(',90.00,9.00,99.00,49.50,49.50,');
    expect(csv).toContain(',2026-08-01,2026-08-15,');
    expect(csv).not.toContain('# organisation');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits a useful header-only CSV when the filtered report is empty', () => {
    const csv = service
      .render(BillingReportType.PAYMENTS, [], 'Australia/Adelaide')
      .toString('utf8');

    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('Payment ID,Invoice Number,Customer');
    expect(csv).not.toContain('No matching data');
  });

  it('uses the actual reconciliation dataset fields', () => {
    expect(service.headings(BillingReportType.RECONCILIATION)).toEqual([
      'Payment ID',
      'Invoice Number',
      'Stripe Payment Intent ID',
      'Internal Payment Amount (AUD)',
      'Internal Refund Amount (AUD)',
      'Currency',
      'Internal Status',
      'Invoice Status',
      'External Evidence',
      'Reconciliation Result',
      'Issues',
      'Last Evidence Date',
    ]);
  });
});
