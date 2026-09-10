'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ApiError, absoluteApiUrl, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

type Tab =
  | 'overview'
  | 'revenue'
  | 'invoices'
  | 'payments'
  | 'receivables'
  | 'refunds'
  | 'subscriptions'
  | 'reconciliation';
type Metric = {
  valueCents?: number;
  count?: number;
  previousPeriodValueCents?: number;
  previousPeriodCount?: number;
  percentageChange: number | null;
  direction: 'up' | 'down' | 'flat' | 'not_comparable';
};
type Summary = {
  period: { from: string; to: string; timezone: string; generatedAt: string };
  reconciliationLastCompletedAt: string | null;
  metrics: Record<string, Metric>;
  tax: {
    gstBilledCents: number;
    gstAssociatedWithPaymentsCents: number;
    gstRefundedOrCreditedCents: number;
  };
  overdue: {
    invoiceCount: number;
    customerCount: number;
    totalAmountCents: number;
    averageDaysOverdue: number;
    oldestInvoiceAgeDays: number;
  };
  paymentHealth: {
    successfulPaymentCount: number;
    successfulPaymentValueCents: number;
    failedPaymentCount: number;
    paymentSuccessRate: number;
    averagePaymentValueCents: number;
    refundCount: number;
    refundValueCents: number;
    creditCount: number;
    creditValueCents: number;
  };
};
type TrendPoint = {
  period: string;
  grossBilledCents: number;
  paymentsReceivedCents: number;
  refundsPaidCents: number;
  netCashCollectedCents: number;
};
type AgeingBucket = {
  key: string;
  label: string;
  customerCount: number;
  invoiceCount: number;
  outstandingAmountCents: number;
};
type PaginatedReport = {
  data?: Array<Record<string, unknown>>;
  trend?: TrendPoint[];
  buckets?: AgeingBucket[];
  summary?: Record<string, unknown>;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
  wholesaleCostStatus?: string;
};

const tabs: Array<{ id: Tab; label: string; endpoint: string }> = [
  { id: 'overview', label: 'Overview', endpoint: 'summary' },
  { id: 'revenue', label: 'Revenue', endpoint: 'revenue' },
  { id: 'invoices', label: 'Invoices', endpoint: 'invoices' },
  { id: 'payments', label: 'Payments', endpoint: 'payments' },
  { id: 'receivables', label: 'Receivables', endpoint: 'receivables' },
  { id: 'refunds', label: 'Refunds & credits', endpoint: 'refunds' },
  { id: 'subscriptions', label: 'Plans', endpoint: 'subscriptions' },
  { id: 'reconciliation', label: 'Reconciliation', endpoint: 'reconciliation' },
];
const presets = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last_7_days', 'Last 7 days'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'],
  ['this_financial_year', 'This financial year'],
  ['custom', 'Custom'],
] as const;
const definitions: Record<string, string> = {
  'Gross billed': 'Valid invoice charges issued during the selected period, including GST.',
  'Payments received':
    'Successful settled payments whose paid timestamp is in the selected period.',
  Outstanding: 'Remaining unpaid invoice balances as at the end of the selected period.',
  'Net cash collected': 'Payments received minus completed cash refunds paid in the period.',
  MRR: 'GST-exclusive monthly-equivalent value of active paid services at period end.',
  'Active services': 'Paid services active as at the end of the selected period.',
  ARPU: 'MRR divided by active paid services.',
  'Overdue balance': 'Unpaid balance after invoice due dates as at period end.',
  'Failed payments': 'Failed finalised payment attempts created during the period.',
  'Refunds paid': 'Successfully completed monetary refunds during the period.',
  'Credits issued': 'Applied non-cash plan-change credits during the period.',
  Unreconciled: 'Transactions with missing evidence or a local state mismatch.',
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const dateTime = (value: string | null | undefined, timezone = 'Australia/Adelaide') =>
  value
    ? new Intl.DateTimeFormat('en-AU', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value))
    : 'Not yet available';

export function BillingReports() {
  const { accessToken, user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const initialTab = tabs.some((item) => item.id === params.get('tab'))
    ? (params.get('tab') as Tab)
    : 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [preset, setPreset] = useState(params.get('preset') ?? 'this_month');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [ageingBucket, setAgeingBucket] = useState(params.get('ageingBucket') ?? '');
  const [paymentStatus, setPaymentStatus] = useState(params.get('paymentStatus') ?? '');
  const [refundStatus, setRefundStatus] = useState(params.get('refundStatus') ?? '');
  const [page, setPage] = useState(Number(params.get('page') ?? 1));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const queryString = useMemo(() => {
    const query = new URLSearchParams({
      preset,
      page: String(page),
      pageSize: '25',
    });
    if (preset === 'custom' && from && to) {
      query.set('from', from);
      query.set('to', to);
    }
    if (search.trim()) query.set('search', search.trim());
    if (ageingBucket && tab === 'receivables') query.set('ageingBucket', ageingBucket);
    if (paymentStatus && tab === 'payments') query.set('paymentStatus', paymentStatus);
    if (refundStatus && tab === 'refunds') query.set('refundStatus', refundStatus);
    return query.toString();
  }, [ageingBucket, from, page, paymentStatus, preset, refundStatus, search, tab, to]);

  const dateReady = preset !== 'custom' || Boolean(from && to);
  const enabled = Boolean(
    accessToken && user && (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && dateReady,
  );
  const summaryQuery = useQuery({
    queryKey: ['billing-reports', 'summary', queryString],
    queryFn: () =>
      apiRequest<Summary>(`/admin/billing/reports/summary?${queryString}`, {}, accessToken),
    enabled,
  });
  const reportEndpoint =
    tab === 'overview' ? 'revenue' : (tabs.find((item) => item.id === tab)?.endpoint ?? 'summary');
  const reportQuery = useQuery({
    queryKey: ['billing-reports', reportEndpoint, queryString],
    queryFn: () =>
      apiRequest<PaginatedReport>(
        `/admin/billing/reports/${reportEndpoint}?${queryString}`,
        {},
        accessToken,
      ),
    enabled,
  });
  const ageingQuery = useQuery({
    queryKey: ['billing-reports', 'receivables-overview', preset, from, to],
    queryFn: () =>
      apiRequest<PaginatedReport>(
        `/admin/billing/reports/receivables?${new URLSearchParams({ preset, ...(preset === 'custom' ? { from, to } : {}), page: '1', pageSize: '5' })}`,
        {},
        accessToken,
      ),
    enabled: enabled && tab === 'overview' && (preset !== 'custom' || Boolean(from && to)),
  });
  const plansQuery = useQuery({
    queryKey: ['billing-reports', 'plans-overview', preset, from, to],
    queryFn: () =>
      apiRequest<PaginatedReport>(
        `/admin/billing/reports/subscriptions?${new URLSearchParams({ preset, ...(preset === 'custom' ? { from, to } : {}), page: '1', pageSize: '5' })}`,
        {},
        accessToken,
      ),
    enabled: enabled && tab === 'overview' && (preset !== 'custom' || Boolean(from && to)),
  });

  if (authLoading) return <ReportsSkeleton />;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN'))
    return (
      <main className="workspace-page mx-auto max-w-7xl px-6 py-10">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Administrator access is required to view billing reports.
        </p>
      </main>
    );

  function navigate(
    nextTab = tab,
    options?: {
      bucket?: string;
      resetPage?: boolean;
      page?: number;
      paymentStatus?: string;
      refundStatus?: string;
    },
  ) {
    if (preset === 'custom' && (!from || !to)) {
      setExportError('Choose both custom dates before applying the reporting period.');
      return;
    }
    const nextBucket = options?.bucket ?? (nextTab === 'receivables' ? ageingBucket : '');
    const nextPaymentStatus =
      options?.paymentStatus ?? (nextTab === 'payments' ? paymentStatus : '');
    const nextRefundStatus = options?.refundStatus ?? (nextTab === 'refunds' ? refundStatus : '');
    const nextPage = options?.page ?? (options?.resetPage === false ? page : 1);
    setTab(nextTab);
    setAgeingBucket(nextBucket);
    setPaymentStatus(nextPaymentStatus);
    setRefundStatus(nextRefundStatus);
    setPage(nextPage);
    const query = new URLSearchParams({ tab: nextTab, preset, page: String(nextPage) });
    if (preset === 'custom') {
      query.set('from', from);
      query.set('to', to);
    }
    if (search.trim()) query.set('search', search.trim());
    if (nextBucket && nextTab === 'receivables') query.set('ageingBucket', nextBucket);
    if (nextPaymentStatus && nextTab === 'payments') query.set('paymentStatus', nextPaymentStatus);
    if (nextRefundStatus && nextTab === 'refunds') query.set('refundStatus', nextRefundStatus);
    router.replace(`/admin/billing/reports?${query.toString()}`);
    setExportError(null);
  }

  async function download(format: 'csv' | 'pdf' | 'xlsx') {
    if (!accessToken || exporting) return;
    const endpoint = tab === 'overview' ? 'revenue' : reportEndpoint;
    setExporting(true);
    setExportError(null);
    try {
      const exportParams = new URLSearchParams(queryString);
      exportParams.set('format', format);
      const response = await fetch(
        absoluteApiUrl(`/admin/billing/reports/${endpoint}/export?${exportParams}`),
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          | { message?: string }
          | undefined;
        throw new ApiError(body?.message ?? 'The report could not be exported.', response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mero-telecom-${endpoint}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setExportError(
        reason instanceof ApiError
          ? reason.message
          : 'The report could not be exported. Please try again.',
      );
    } finally {
      setExporting(false);
    }
  }

  const summary = summaryQuery.data;
  const trend = reportQuery.data?.trend ?? [];
  const rows = reportQuery.data?.data ?? [];
  const isError =
    summaryQuery.isError || reportQuery.isError || ageingQuery.isError || plansQuery.isError;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">BILLING · REPORTING</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Billing &amp; Revenue Reports</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Operational billing, collections, receivables and reconciliation—kept as separate
            financial concepts.
          </p>
          {summary ? (
            <p className="mt-2 text-xs text-slate-500">
              Data current as of {dateTime(summary.period.generatedAt, summary.period.timezone)} ·{' '}
              {summary.period.timezone}
              {' · '}Stripe evidence last recorded{' '}
              {dateTime(summary.reconciliationLastCompletedAt, summary.period.timezone)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
            <button
              key={format}
              className={format === 'pdf' ? 'button-primary' : 'button-secondary'}
              disabled={exporting}
              onClick={() => void download(format)}
            >
              {exporting ? 'Working…' : format.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {exportError ? (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
          {exportError}
        </p>
      ) : null}

      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_2fr_auto] lg:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Reporting period
            <select
              className="field"
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
            >
              {presets.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className={`grid gap-3 sm:grid-cols-2 ${preset === 'custom' ? '' : 'opacity-50'}`}>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              From
              <input
                className="field"
                type="date"
                disabled={preset !== 'custom'}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              To
              <input
                className="field"
                type="date"
                disabled={preset !== 'custom'}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
          <button className="button-primary" onClick={() => navigate(tab)}>
            Apply period
          </button>
        </div>
        {tab !== 'overview' ? (
          <form
            className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(tab);
            }}
          >
            <input
              className="field flex-1"
              aria-label="Search report"
              placeholder="Search customer, invoice or provider reference"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="button-secondary" type="submit">
              Search
            </button>
          </form>
        ) : null}
      </section>

      <nav
        aria-label="Billing report sections"
        className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-200 pb-2"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${tab === item.id ? 'bg-sky-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => navigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {isError ? (
        <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
          Unable to load all report data. Retry the request or narrow the reporting period.
        </p>
      ) : null}

      {tab === 'overview' ? (
        <Overview
          summary={summary}
          trend={trend}
          ageing={ageingQuery.data?.buckets ?? []}
          plans={plansQuery.data?.data ?? []}
          loading={summaryQuery.isLoading || reportQuery.isLoading}
          onDrillDown={(nextTab, options) => navigate(nextTab, options)}
        />
      ) : (
        <ReportTable
          tab={tab}
          report={reportQuery.data}
          rows={rows}
          loading={reportQuery.isLoading}
          page={page}
          activeBucket={ageingBucket}
          setPage={(nextPage) => navigate(tab, { resetPage: false, page: nextPage })}
          onBucket={(bucket) => navigate('receivables', { bucket })}
        />
      )}
    </main>
  );
}

function Overview({
  summary,
  trend,
  ageing,
  plans,
  loading,
  onDrillDown,
}: {
  summary?: Summary;
  trend: TrendPoint[];
  ageing: AgeingBucket[];
  plans: Array<Record<string, unknown>>;
  loading: boolean;
  onDrillDown: (
    tab: Tab,
    options?: { bucket?: string; paymentStatus?: string; refundStatus?: string },
  ) => void;
}) {
  if (loading) return <ReportsSkeleton compact />;
  if (!summary)
    return (
      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        No reporting summary is available.
      </p>
    );
  const rows: Array<
    Array<{
      label: string;
      metric: Metric;
      warning?: boolean;
      target: Tab;
      options?: { bucket?: string; paymentStatus?: string; refundStatus?: string };
    }>
  > = [
    [
      { label: 'Gross billed', metric: summary.metrics.grossBilled, target: 'invoices' },
      { label: 'Payments received', metric: summary.metrics.paymentsReceived, target: 'payments' },
      {
        label: 'Outstanding',
        metric: summary.metrics.outstanding,
        warning: true,
        target: 'receivables',
      },
      { label: 'Net cash collected', metric: summary.metrics.netCashCollected, target: 'revenue' },
    ],
    [
      { label: 'MRR', metric: summary.metrics.mrr, target: 'subscriptions' },
      { label: 'Active services', metric: summary.metrics.activeServices, target: 'subscriptions' },
      { label: 'ARPU', metric: summary.metrics.arpu, target: 'subscriptions' },
      {
        label: 'Overdue balance',
        metric: summary.metrics.overdueBalance,
        warning: true,
        target: 'receivables',
        options: { bucket: 'overdue' },
      },
    ],
    [
      {
        label: 'Failed payments',
        metric: summary.metrics.failedPayments,
        warning: true,
        target: 'payments',
        options: { paymentStatus: 'FAILED' },
      },
      {
        label: 'Refunds paid',
        metric: summary.metrics.refundsPaid,
        warning: true,
        target: 'refunds',
        options: { refundStatus: 'SUCCEEDED' },
      },
      {
        label: 'Credits issued',
        metric: summary.metrics.creditsIssued,
        warning: true,
        target: 'refunds',
      },
      {
        label: 'Unreconciled',
        metric: summary.metrics.unreconciledTransactions,
        warning: true,
        target: 'reconciliation',
      },
    ],
  ];
  return (
    <div className="mt-6 space-y-6">
      {rows.map((cardRow, rowIndex) => (
        <section key={rowIndex} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cardRow.map((card) => (
            <KpiCard
              key={card.label}
              {...card}
              onClick={() => onDrillDown(card.target, card.options)}
            />
          ))}
        </section>
      ))}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Revenue &amp; collection trend</h2>
            <p className="mt-1 text-sm text-slate-500">
              Billed amounts, settled cash and completed refunds are shown separately.
            </p>
          </div>
          <button
            className="text-sm font-semibold text-sky-700"
            onClick={() => onDrillDown('revenue')}
          >
            Open report
          </button>
        </div>
        <div className="mt-5 h-72">
          {trend.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="period" />
                <YAxis
                  tickFormatter={(value) => money(Number(value)).replace('.00', '')}
                  width={85}
                />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="grossBilledCents"
                  name="Gross billed"
                  stroke="#087f8c"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="paymentsReceivedCents"
                  name="Payments received"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="refundsPaidCents"
                  name="Refunds"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="netCashCollectedCents"
                  name="Net cash"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="Not enough historical data to show a trend." />
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Receivables ageing</h2>
          <p className="mt-1 text-sm text-slate-500">
            A snapshot at the reporting-period end, aged from invoice due date.
          </p>
          {ageing.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {ageing.map((bucket) => (
                <button
                  key={bucket.key}
                  className="rounded-lg border border-slate-200 p-3 text-left hover:border-sky-400 hover:bg-sky-50"
                  onClick={() => onDrillDown('receivables', { bucket: bucket.key })}
                >
                  <span className="block text-xs text-slate-500">{bucket.label}</span>
                  <strong className="mt-1 block text-lg">
                    {money(bucket.outstandingAmountCents)}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {bucket.invoiceCount} invoices · {bucket.customerCount} customers
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text="No outstanding receivables at the reporting-period end." />
          )}
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Payment health</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat
              label="Success rate"
              value={`${summary.paymentHealth.paymentSuccessRate.toFixed(2)}%`}
            />
            <Stat
              label="Average payment"
              value={money(summary.paymentHealth.averagePaymentValueCents)}
            />
            <Stat
              label="Successful payments"
              value={String(summary.paymentHealth.successfulPaymentCount)}
            />
            <Stat
              label="Failed payments"
              value={String(summary.paymentHealth.failedPaymentCount)}
            />
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
            GST billed {money(summary.tax.gstBilledCents)} · GST associated with collected payments{' '}
            {money(summary.tax.gstAssociatedWithPaymentsCents)} · GST refunded/credited{' '}
            {money(summary.tax.gstRefundedOrCreditedCents)}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between">
            <div>
              <h2 className="font-semibold">Plan performance</h2>
              <p className="mt-1 text-sm text-slate-500">
                GST-exclusive MRR by active service plan.
              </p>
            </div>
            <button
              className="text-sm font-semibold text-sky-700"
              onClick={() => onDrillDown('subscriptions')}
            >
              View plans
            </button>
          </div>
          <div className="mt-4 h-56">
            {plans.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={plans}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="planName" />
                  <YAxis tickFormatter={(value) => money(Number(value)).replace('.00', '')} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Bar dataKey="mrrCents" name="MRR" fill="#087f8c" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="No active plan data is available." />
            )}
          </div>
          <p className="mt-3 text-xs text-amber-700">
            Wholesale cost data not configured; contribution and margin are intentionally
            unavailable.
          </p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
          <h2 className="font-semibold text-slate-900">Attention required</h2>
          <div className="mt-4 space-y-2">
            <Attention
              label="Invoices over 60 days overdue"
              value={ageing
                .filter((bucket) => bucket.key === '61-90' || bucket.key === '90+')
                .reduce((sum, bucket) => sum + bucket.invoiceCount, 0)}
              onClick={() => onDrillDown('receivables', { bucket: 'over_60' })}
            />
            <Attention
              label="Failed payment attempts"
              value={summary.paymentHealth.failedPaymentCount}
              onClick={() => onDrillDown('payments', { paymentStatus: 'FAILED' })}
            />
            <Attention
              label="Unreconciled transactions"
              value={summary.metrics.unreconciledTransactions.count ?? 0}
              onClick={() => onDrillDown('reconciliation')}
            />
          </div>
        </article>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  metric,
  warning,
  onClick,
}: {
  label: string;
  metric: Metric;
  warning?: boolean;
  onClick: () => void;
}) {
  const value =
    metric.valueCents === undefined ? String(metric.count ?? 0) : money(metric.valueCents);
  const comparison =
    metric.percentageChange === null
      ? 'No comparable prior-period baseline'
      : `${metric.percentageChange > 0 ? '↑' : metric.percentageChange < 0 ? '↓' : '→'} ${Math.abs(metric.percentageChange).toFixed(1)}% vs previous period`;
  const comparisonTone =
    metric.direction === 'flat' || metric.direction === 'not_comparable'
      ? 'text-slate-500'
      : warning
        ? metric.direction === 'up'
          ? 'text-amber-700'
          : 'text-emerald-700'
        : metric.direction === 'up'
          ? 'text-emerald-700'
          : 'text-slate-600';
  return (
    <button
      className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow"
      onClick={onClick}
      title={definitions[label]}
    >
      <span className="flex items-center gap-1 text-sm text-slate-500">
        {label}
        <span aria-hidden="true" className="cursor-help text-slate-400">
          ⓘ
        </span>
      </span>
      <strong className="mt-2 block text-2xl text-slate-900">{value}</strong>
      <span className={`mt-2 block text-xs ${comparisonTone}`}>{comparison}</span>
    </button>
  );
}

function ReportTable({
  tab,
  report,
  rows,
  loading,
  page,
  activeBucket,
  setPage,
  onBucket,
}: {
  tab: Tab;
  report?: PaginatedReport;
  rows: Array<Record<string, unknown>>;
  loading: boolean;
  page: number;
  activeBucket: string;
  setPage: (page: number) => void;
  onBucket: (bucket: string) => void;
}) {
  if (loading) return <ReportsSkeleton compact />;
  const visibleKeys = rows.length
    ? Object.keys(rows[0]).filter((key) => !hiddenTableKeys.has(key))
    : [];
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-semibold">{tabs.find((item) => item.id === tab)?.label}</h2>
          {tab === 'reconciliation' ? (
            <p className="mt-1 text-xs text-slate-500">
              Read-only comparison against recorded Stripe webhook evidence. No financial records
              are changed.
            </p>
          ) : null}
          {tab === 'subscriptions' && report?.wholesaleCostStatus === 'NOT_CONFIGURED' ? (
            <p className="mt-1 text-xs text-amber-700">Wholesale cost data not configured.</p>
          ) : null}
        </div>
        {tab === 'receivables' && report?.buckets ? (
          <select
            className="field max-w-xs"
            aria-label="Ageing bucket"
            value={activeBucket}
            onChange={(event) => onBucket(event.target.value)}
          >
            <option value="">All ageing buckets</option>
            <option value="overdue">All overdue</option>
            <option value="over_60">Over 60 days overdue</option>
            {report.buckets.map((bucket) => (
              <option key={bucket.key} value={bucket.key}>
                {bucket.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {visibleKeys.map((key) => (
                  <th key={key} className="whitespace-nowrap px-4 py-3">
                    {friendlyLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => (
                <tr
                  key={String(
                    row.invoiceNumber ?? row.paymentId ?? row.refundId ?? row.planId ?? index,
                  )}
                  className="hover:bg-slate-50"
                >
                  {visibleKeys.map((key) => (
                    <td key={key} className="max-w-sm whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatCell(key, row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          text={
            tab === 'reconciliation'
              ? 'No reconciliation exceptions or transactions match these filters.'
              : 'No billing records match the selected period and filters.'
          }
        />
      )}
      {report?.meta && report.meta.totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 text-sm">
          <span>
            Page {report.meta.page} of {report.meta.totalPages} · {report.meta.total} results
          </span>
          <div className="flex gap-2">
            <button
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="button-secondary"
              disabled={page >= report.meta.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReportsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <main
      className={`${compact ? 'mt-6' : 'workspace-page mx-auto max-w-7xl px-6 py-10'} animate-pulse`}
      aria-label="Loading billing reports"
    >
      <div className="h-8 w-72 rounded bg-slate-200" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: compact ? 4 : 8 }, (_, index) => (
          <div key={index} className="h-28 rounded-xl bg-slate-100" />
        ))}
      </div>
    </main>
  );
}
function EmptyState({ text }: { text: string }) {
  return (
    <p className="grid min-h-36 place-items-center p-8 text-center text-sm text-slate-500">
      {text}
    </p>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <span className="block text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg">{value}</strong>
    </div>
  );
}
function Attention({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: () => void;
}) {
  if (value === 0) return null;
  return (
    <button
      className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm hover:border-amber-400"
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}
function friendlyLabel(value: string) {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}
const hiddenTableKeys = new Set(['customerId', 'planId', 'paymentId', 'refundId']);
function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && key.toLowerCase().endsWith('cents')) return money(value);
  if (typeof value === 'number' && key.toLowerCase().includes('percentage'))
    return `${value.toFixed(2)}%`;
  if (Array.isArray(value)) return value.length ? value.join('; ') : 'None';
  if (typeof value === 'string' && /(?:At|Date)$/.test(key) && !Number.isNaN(Date.parse(value)))
    return dateTime(value);
  if (
    typeof value === 'string' &&
    /(?:status|bucket|provider|billingCycle|reconciliationStatus)$/i.test(key)
  )
    return value
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (letter) => letter.toUpperCase());
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
