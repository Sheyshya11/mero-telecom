import { Injectable } from '@nestjs/common';

import type { ReportRow } from '../billing-report-export.types';
import { BillingReportType } from '../dto/billing-report-query.dto';

type CsvValueKind = 'date' | 'datetime' | 'money' | 'number' | 'percentage' | 'text';

interface CsvColumn {
  heading: string;
  key: string;
  kind?: CsvValueKind;
}

const CSV_COLUMNS: Record<BillingReportType, CsvColumn[]> = {
  [BillingReportType.REVENUE]: [
    { heading: 'Period', key: 'period', kind: 'text' },
    { heading: 'Gross Billed (AUD)', key: 'grossBilledCents', kind: 'money' },
    { heading: 'Payments Received (AUD)', key: 'paymentsReceivedCents', kind: 'money' },
    { heading: 'Refunds Paid (AUD)', key: 'refundsPaidCents', kind: 'money' },
    { heading: 'Net Cash Collected (AUD)', key: 'netCashCollectedCents', kind: 'money' },
  ],
  [BillingReportType.INVOICES]: [
    { heading: 'Invoice Number', key: 'invoiceNumber' },
    { heading: 'Customer', key: 'customer' },
    { heading: 'Customer Email', key: 'customerEmail' },
    { heading: 'Plan', key: 'plan' },
    { heading: 'Billing Period', key: 'billingPeriod', kind: 'date' },
    { heading: 'Issue Date', key: 'issueDate', kind: 'date' },
    { heading: 'Due Date', key: 'dueDate', kind: 'date' },
    { heading: 'Subtotal (AUD)', key: 'subtotalCents', kind: 'money' },
    { heading: 'GST (AUD)', key: 'gstCents', kind: 'money' },
    { heading: 'Total (AUD)', key: 'totalCents', kind: 'money' },
    { heading: 'Paid (AUD)', key: 'amountPaidCents', kind: 'money' },
    { heading: 'Outstanding (AUD)', key: 'amountDueCents', kind: 'money' },
    { heading: 'Status', key: 'status' },
    { heading: 'Paid Date', key: 'paidDate', kind: 'date' },
  ],
  [BillingReportType.PAYMENTS]: [
    { heading: 'Payment ID', key: 'paymentId' },
    { heading: 'Invoice Number', key: 'invoiceNumber' },
    { heading: 'Customer', key: 'customer' },
    { heading: 'Customer Email', key: 'customerEmail' },
    { heading: 'Amount (AUD)', key: 'amountCents', kind: 'money' },
    { heading: 'Payment Method', key: 'paymentMethod' },
    { heading: 'Status', key: 'status' },
    { heading: 'Payment Date', key: 'paymentDate', kind: 'datetime' },
    { heading: 'Stripe Payment Intent ID', key: 'stripePaymentIntentId' },
    { heading: 'Failure Reason', key: 'failureReason' },
    { heading: 'Refunded (AUD)', key: 'refundedCents', kind: 'money' },
  ],
  [BillingReportType.RECEIVABLES]: [
    { heading: 'Invoice Number', key: 'invoiceNumber' },
    { heading: 'Customer', key: 'customer' },
    { heading: 'Customer Number', key: 'customerNumber' },
    { heading: 'Due Date', key: 'dueDate', kind: 'date' },
    { heading: 'Days Overdue', key: 'daysOverdue', kind: 'number' },
    { heading: 'Ageing Bucket', key: 'ageingBucket' },
    { heading: 'Invoice Total (AUD)', key: 'totalCents', kind: 'money' },
    { heading: 'Paid (AUD)', key: 'paidCents', kind: 'money' },
    { heading: 'Outstanding (AUD)', key: 'outstandingAmountCents', kind: 'money' },
    { heading: 'Status', key: 'status' },
  ],
  [BillingReportType.REFUNDS]: [
    { heading: 'Refund ID', key: 'refundId' },
    { heading: 'Customer', key: 'customer' },
    { heading: 'Customer Email', key: 'customerEmail' },
    { heading: 'Invoice Number', key: 'invoiceNumber' },
    { heading: 'Original Payment ID', key: 'paymentId' },
    { heading: 'Refund Amount (AUD)', key: 'refundAmountCents', kind: 'money' },
    { heading: 'Reason', key: 'reason' },
    { heading: 'Requested Date', key: 'requestedDate', kind: 'datetime' },
    { heading: 'Requested By', key: 'requestedBy' },
    { heading: 'Approved By', key: 'approvedBy' },
    { heading: 'Approval Date', key: 'approvalDate', kind: 'datetime' },
    { heading: 'Status', key: 'status' },
    { heading: 'Stripe Refund ID', key: 'stripeRefundId' },
    { heading: 'Completed Date', key: 'completedDate', kind: 'datetime' },
  ],
  [BillingReportType.SUBSCRIPTIONS]: [
    { heading: 'Plan Name', key: 'planName' },
    { heading: 'Active Services', key: 'activeServices', kind: 'number' },
    {
      heading: 'Share of Active Services (%)',
      key: 'percentageOfActiveServices',
      kind: 'percentage',
    },
    { heading: 'MRR (AUD)', key: 'mrrCents', kind: 'money' },
    { heading: 'ARPU (AUD)', key: 'arpuCents', kind: 'money' },
    { heading: 'Gross Billed (AUD)', key: 'grossBilledCents', kind: 'money' },
    { heading: 'Collected (AUD)', key: 'collectedCents', kind: 'money' },
    { heading: 'Refunds (AUD)', key: 'refundsCents', kind: 'money' },
    { heading: 'Wholesale Cost (AUD)', key: 'wholesaleCostCents', kind: 'money' },
    { heading: 'Gross Contribution (AUD)', key: 'grossContributionCents', kind: 'money' },
    { heading: 'Gross Margin (%)', key: 'grossMarginPercentage', kind: 'percentage' },
  ],
  [BillingReportType.RECONCILIATION]: [
    { heading: 'Payment ID', key: 'paymentId' },
    { heading: 'Invoice Number', key: 'invoiceNumber' },
    { heading: 'Stripe Payment Intent ID', key: 'stripePaymentIntentId' },
    { heading: 'Internal Payment Amount (AUD)', key: 'internalPaymentAmountCents', kind: 'money' },
    { heading: 'Internal Refund Amount (AUD)', key: 'internalRefundAmountCents', kind: 'money' },
    { heading: 'Currency', key: 'currency' },
    { heading: 'Internal Status', key: 'internalStatus' },
    { heading: 'Invoice Status', key: 'invoiceStatus' },
    { heading: 'External Evidence', key: 'externalEvidence' },
    { heading: 'Reconciliation Result', key: 'result' },
    { heading: 'Issues', key: 'issues' },
    { heading: 'Last Evidence Date', key: 'lastEvidenceAt', kind: 'datetime' },
  ],
};

@Injectable()
export class BillingReportCsvService {
  render(reportType: BillingReportType, rows: ReportRow[], timezone: string): Buffer {
    const columns = CSV_COLUMNS[reportType];
    const records = [
      columns.map((column) => this.escape(column.heading)).join(','),
      ...rows.map((row) =>
        columns
          .map((column) => this.escape(this.format(row[column.key], column.kind, timezone)))
          .join(','),
      ),
    ];
    return Buffer.from(`\ufeff${records.join('\r\n')}\r\n`, 'utf8');
  }

  headings(reportType: BillingReportType): string[] {
    return CSV_COLUMNS[reportType].map((column) => column.heading);
  }

  private format(value: unknown, kind: CsvValueKind = 'text', timezone: string): string {
    if (value === null || value === undefined) return '';
    if (kind === 'money') {
      return typeof value === 'number' && Number.isFinite(value) ? (value / 100).toFixed(2) : '';
    }
    if (kind === 'number' || kind === 'percentage') {
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
    }
    if (kind === 'date' || kind === 'datetime') {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(kind === 'datetime'
          ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' as const }
          : {}),
        timeZone: timezone,
      }).formatToParts(date);
      const part = (name: Intl.DateTimeFormatPartTypes) =>
        parts.find((candidate) => candidate.type === name)?.value ?? '';
      const dateText = `${part('year')}-${part('month')}-${part('day')}`;
      return kind === 'datetime'
        ? `${dateText} ${part('hour')}:${part('minute')}:${part('second')}`
        : dateText;
    }
    const text = Array.isArray(value) ? value.map(String).join('; ') : String(value);
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  private escape(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }
}
