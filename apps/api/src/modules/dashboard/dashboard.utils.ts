export interface InvoiceTrendSource {
  issueDate: Date;
  totalCents: number;
}

export function buildInvoiceTrend(invoices: InvoiceTrendSource[], endDate: Date, months = 6) {
  const buckets = new Map<
    string,
    { month: string; label: string; totalCents: number; count: number }
  >();
  const cursor = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - months + 1, 1),
  );

  for (let offset = 0; offset < months; offset += 1) {
    const month = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + offset, 1));
    const key = month.toISOString().slice(0, 7);
    buckets.set(key, {
      month: key,
      label: new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' }).format(month),
      totalCents: 0,
      count: 0,
    });
  }

  for (const invoice of invoices) {
    const key = invoice.issueDate.toISOString().slice(0, 7);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.totalCents += invoice.totalCents;
      bucket.count += 1;
    }
  }

  return [...buckets.values()];
}

export function startOfTrendPeriod(endDate: Date, months = 6): Date {
  return new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - months + 1, 1));
}
