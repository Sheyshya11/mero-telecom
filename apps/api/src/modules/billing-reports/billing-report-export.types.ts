import type { BillingReportType } from './dto/billing-report-query.dto';

export type ReportRow = Record<string, unknown>;

export interface BillingReportExportMetadata {
  organisation: string;
  reportType: BillingReportType;
  reportName: string;
  reportId: string;
  from: string;
  to: string;
  fromLocalDate: string;
  toLocalDate: string;
  timezone: string;
  generatedAt: string;
  generatedBy: string;
  currency: string;
  activeFilters: Record<string, string | number>;
}

export interface BillingReportExportDocument {
  metadata: BillingReportExportMetadata;
  report: unknown;
  rows: ReportRow[];
  overview: unknown;
  revenue: unknown;
  plans: unknown;
}

export interface GeneratedBillingReportExport {
  buffer: Buffer;
  contentType: string;
  extension: 'csv' | 'pdf' | 'xlsx';
  fileName: string;
}
