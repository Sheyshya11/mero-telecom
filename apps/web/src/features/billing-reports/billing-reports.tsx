'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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
type Summary = {
  totalInvoices: number;
  grossAmountCents: number;
  paymentsReceivedCents: number;
  outstandingBalanceCents: number;
  refundAmountCents: number;
  creditsAppliedCents: number;
  gstCollectedCents: number;
  netRevenueCents: number;
  paidInvoices: number;
  overdueInvoices: number;
  failedPayments: number;
  activeSubscriptions: number;
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

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

export function BillingReports() {
  const { accessToken, user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const initialTab = (
    tabs.some((tab) => tab.id === params.get('tab')) ? params.get('tab') : 'overview'
  ) as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [from, setFrom] = useState(
    params.get('from') ??
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10),
  );
  const [to, setTo] = useState(params.get('to') ?? new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const queryString = useMemo(
    () => new URLSearchParams({ from, to, page: '1', pageSize: '25' }).toString(),
    [from, to],
  );
  const summaryQuery = useQuery({
    queryKey: ['billing-reports', 'summary', from, to],
    queryFn: () =>
      apiRequest<Summary>(`/admin/billing/reports/summary?${queryString}`, {}, accessToken),
    enabled: Boolean(accessToken && user && user.role !== 'CUSTOMER'),
  });
  const reportEndpoint =
    tab === 'overview' ? 'revenue' : (tabs.find((item) => item.id === tab)?.endpoint ?? 'summary');
  const reportQuery = useQuery({
    queryKey: ['billing-reports', reportEndpoint, from, to],
    queryFn: () =>
      apiRequest<Record<string, unknown>>(
        `/admin/billing/reports/${reportEndpoint}?${queryString}`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken),
  });

  if (authLoading)
    return <main className="workspace-page mx-auto max-w-7xl px-6 py-10">Loading reports…</main>;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN'))
    return (
      <main className="workspace-page mx-auto max-w-7xl px-6 py-10">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          Administrator access is required to view billing reports.
        </p>
      </main>
    );

  function applyRange(nextTab = tab) {
    setTab(nextTab);
    router.replace(`/admin/billing/reports?tab=${nextTab}&from=${from}&to=${to}`);
  }

  async function download(format: 'csv' | 'pdf' | 'xlsx') {
    if (!accessToken || exporting) return;
    const endpoint =
      tab === 'overview'
        ? 'revenue'
        : (tabs.find((item) => item.id === tab)?.endpoint ?? 'summary');
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(
        absoluteApiUrl(
          `/admin/billing/reports/${endpoint}/export?${new URLSearchParams({ from, to, format }).toString()}`,
        ),
        { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' },
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
  const cards = summary
    ? [
        ['Gross billed', money(summary.grossAmountCents)],
        ['Payments received', money(summary.paymentsReceivedCents)],
        ['Outstanding', money(summary.outstandingBalanceCents)],
        ['Refunds', money(summary.refundAmountCents)],
        ['GST collected', money(summary.gstCollectedCents)],
        ['Net revenue', money(summary.netRevenueCents)],
        ['Invoices', summary.totalInvoices],
        ['Active subscriptions', summary.activeSubscriptions],
      ]
    : [];
  const trend =
    (reportQuery.data?.trend as Array<{ period: string; grossCents: number }> | undefined) ?? [];
  const rows = (reportQuery.data?.data as Array<Record<string, unknown>> | undefined) ?? [];

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · BILLING</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Billing &amp; Revenue Reports</h1>
          <p className="mt-2 text-slate-600">
            Financial reporting sourced from Mero Telecom records.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="button-secondary"
            disabled={exporting}
            onClick={() => void download('csv')}
          >
            {exporting ? 'Exporting…' : 'CSV'}
          </button>
          <button
            className="button-secondary"
            disabled={exporting}
            onClick={() => void download('xlsx')}
          >
            XLSX
          </button>
          <button
            className="button-primary"
            disabled={exporting}
            onClick={() => void download('pdf')}
          >
            PDF
          </button>
        </div>
      </header>
      {exportError ? (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
          {exportError}
        </p>
      ) : null}
      <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Reporting period</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Choose the dates used across the summary, reports, and exports.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            From
            <input
              className="field"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            To
            <input
              className="field"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button className="button-primary" onClick={() => applyRange()}>
            Apply period
          </button>
        </div>
      </section>
      <nav
        aria-label="Billing report sections"
        className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-200 pb-2"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === item.id ? 'bg-sky-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => applyRange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {summaryQuery.isError || reportQuery.isError ? (
        <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
          Unable to load this report. Please retry.
        </p>
      ) : null}
      {tab === 'overview' ? (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(([label, value]) => (
              <article
                key={String(label)}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
              </article>
            ))}
          </section>
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Revenue overview</h2>
            <div className="mt-4 h-64">
              {trend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <XAxis dataKey="period" />
                    <YAxis tickFormatter={(value) => `$${Math.round(value / 100)}`} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Line type="monotone" dataKey="grossCents" stroke="#087f8c" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-20 text-center text-sm text-slate-500">
                  No billing records matched the selected period.
                </p>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold">{tabs.find((item) => item.id === tab)?.label}</h2>
          </div>
          {reportQuery.isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading report…</p>
          ) : rows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {Object.keys(rows[0]).map((key) => (
                      <th key={key} className="whitespace-nowrap px-4 py-3">
                        {key.replace(/([A-Z])/g, ' $1')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50">
                      {Object.entries(row).map(([key, value]) => (
                        <td key={key} className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {typeof value === 'number' && key.toLowerCase().endsWith('cents')
                            ? money(value)
                            : String(value ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-10 text-center text-sm text-slate-500">
              No billing records matched the selected period and filters.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
