'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../auth/auth-provider';
import { apiRequest } from '../../lib/api/client';
import type { AdminDashboard } from './dashboard.types';

const statusColors = {
  ACTIVE: '#059669',
  PENDING: '#0284c7',
  SUSPENDED: '#d97706',
  CANCELLED: '#64748b',
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function AdminDashboardView() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiRequest<AdminDashboard>('/dashboard/admin', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'ADMIN'),
  });
  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user) return <Status message="Sign in to view the dashboard." />;
  if (user.role !== 'ADMIN') return <Status message="Administrator access is required." />;
  if (dashboardQuery.isPending) return <Status message="Loading dashboard…" />;
  if (dashboardQuery.isError || !dashboardQuery.data)
    return (
      <Status
        message="Unable to load dashboard data."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  const dashboard = dashboardQuery.data;
  const trend = dashboard.invoiceTrend.map((point) => ({
    ...point,
    totalDollars: point.totalCents / 100,
  }));
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · ADMIN</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Business dashboard
          </h1>
          <p className="mt-2 text-slate-600">
            A current operational view of customers, subscriptions, and invoices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button-secondary" href="/admin/customers">
            Customers
          </Link>
          <Link className="button-secondary" href="/admin/plans">
            Plans
          </Link>
          <Link className="button-secondary" href="/admin/subscriptions">
            Subscriptions
          </Link>
          <button className="button-primary" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </div>
      </header>
      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Customers"
          value={String(dashboard.metrics.customerCount)}
          detail="Customer accounts"
        />
        <Metric
          label="Active services"
          value={String(dashboard.metrics.activeSubscriptions)}
          detail="Current subscriptions"
        />
        <Metric
          label="Monthly recurring revenue"
          value={formatMoney(dashboard.metrics.monthlyRecurringRevenueCents)}
          detail="Active plan value"
        />
        <Metric
          label="Outstanding invoices"
          value={formatMoney(dashboard.metrics.outstandingInvoiceCents)}
          detail="Issued and overdue"
        />
        <Metric
          label="Overdue invoices"
          value={String(dashboard.metrics.overdueInvoiceCount)}
          detail="Requires follow-up"
          warning
        />
      </section>
      <section className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel title="Invoice value by month">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `$${value}`}
                />
                <Tooltip
                  formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, 'Invoice value']}
                />
                <Bar dataKey="totalDollars" fill="#0284c7" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Subscriptions by status">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={dashboard.subscriptionsByStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="46%"
                  outerRadius={82}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {dashboard.subscriptionsByStatus.map((entry) => (
                    <Cell fill={statusColors[entry.status]} key={entry.status} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>
      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="font-semibold text-slate-950">Recent invoices</h2>
          <span className="text-sm text-slate-500">Latest five records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-150 text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Invoice</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Issue date</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.recentInvoices.map((invoice) => (
                <tr className="border-b border-slate-100 last:border-0" key={invoice.id}>
                  <td className="px-6 py-4 font-medium text-slate-900">{invoice.invoiceNumber}</td>
                  <td className="px-6 py-4 text-slate-700">{invoice.customerName}</td>
                  <td className="px-6 py-4 text-slate-600">
                    {new Date(invoice.issueDate).toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={invoice.status} />
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-slate-900">
                    {formatMoney(invoice.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  detail,
  warning = false,
}: Readonly<{ label: string; value: string; detail: string; warning?: boolean }>) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-3 text-2xl font-bold ${warning ? 'text-amber-700' : 'text-slate-950'}`}>
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </article>
  );
}
function Panel({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-slate-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function StatusBadge({ status }: Readonly<{ status: string }>) {
  const colors: Record<string, string> = {
    PAID: 'bg-emerald-100 text-emerald-800',
    ISSUED: 'bg-sky-100 text-sky-800',
    OVERDUE: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-slate-100 text-slate-700',
    DRAFT: 'bg-slate-100 text-slate-700',
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  );
}
function Status({ message, onRetry }: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <div>
        <p>{message}</p>
        {onRetry ? (
          <button className="button-secondary mt-4" onClick={onRetry} type="button">
            Retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
