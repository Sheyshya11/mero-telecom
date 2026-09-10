export type ReportPeriod = {
  from: string;
  to: string;
  timezone: string;
  generatedAt: string;
};

export type ResolvedReportPeriod = {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  timezone: string;
  generatedAt: Date;
  fromLocalDate: string;
  toLocalDate: string;
};

export type MoneyMetric = {
  valueCents: number;
  previousPeriodValueCents: number;
  percentageChange: number | null;
  direction: 'up' | 'down' | 'flat' | 'not_comparable';
};

export type CountMetric = {
  count: number;
  previousPeriodCount: number;
  percentageChange: number | null;
  direction: 'up' | 'down' | 'flat' | 'not_comparable';
};

export type ReceivablesAgeingBucket = {
  key: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  label: string;
  customerCount: number;
  invoiceCount: number;
  outstandingAmountCents: number;
};

export type ReconciliationStatus =
  | 'MATCHED'
  | 'MISMATCH'
  | 'MISSING_INTERNAL'
  | 'MISSING_EXTERNAL'
  | 'NEEDS_REVIEW';
