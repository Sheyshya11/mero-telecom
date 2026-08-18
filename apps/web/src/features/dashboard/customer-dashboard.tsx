'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { apiDownload, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { StripeCheckoutButton } from '../payments/stripe-checkout-button';
import type { CustomerDashboard, CustomerInvoice } from './customer-dashboard.types';

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-AU');
}

export function CustomerDashboardView() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ['customer-dashboard'],
    queryFn: () => apiRequest<CustomerDashboard>('/dashboard/customer', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });

  if (isLoading) return <Status message="Restoring your session..." />;
  if (!user) return <Status message="Sign in to view your account." />;
  if (user.role !== 'CUSTOMER') return <Status message="Customer access is required." />;
  if (dashboardQuery.isPending) return <Status message="Loading your dashboard..." />;
  if (dashboardQuery.isError || !dashboardQuery.data)
    return (
      <Status
        message="Unable to load your account information."
        onRetry={() => void dashboardQuery.refetch()}
      />
    );

  const dashboard = dashboardQuery.data;
  const customerName = `${dashboard.profile.firstName} ${dashboard.profile.lastName}`;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Welcome back, {dashboard.profile.firstName}
          </h1>
          <p className="mt-2 text-slate-600">
            Account {dashboard.profile.customerNumber} - {dashboard.profile.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button-secondary" href="/customer/subscription">
            My subscription
          </Link>
          <Link className="button-secondary" href="/customer/invoices">
            Invoice history
          </Link>
          <Link className="button-secondary" href="/customer/profile">
            My profile
          </Link>
          <button className="button-primary" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </div>
      </header>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <Panel title="Your internet service">
          {dashboard.subscription ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-2xl font-bold text-slate-950">
                  {dashboard.subscription.plan.name}
                </p>
                <p className="mt-2 text-slate-600">
                  {dashboard.subscription.plan.downloadMbps} Mbps download /{' '}
                  {dashboard.subscription.plan.uploadMbps} Mbps upload
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  Started {formatDate(dashboard.subscription.startDate)}
                </p>
              </div>
              <div className="sm:text-right">
                <StatusBadge status={dashboard.subscription.status} />
                <p className="mt-4 text-2xl font-bold text-slate-950">
                  {formatMoney(dashboard.subscription.plan.monthlyCents)}
                </p>
                <p className="text-sm text-slate-500">per month, GST included</p>
              </div>
            </div>
          ) : (
            <p className="text-slate-600">You do not have a current internet service.</p>
          )}
        </Panel>
        <Panel title="Account details">
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-slate-500">Account holder</dt>
              <dd className="mt-1 font-medium text-slate-950">{customerName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd className="mt-1 font-medium text-slate-950">{dashboard.profile.phone}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Account number</dt>
              <dd className="mt-1 font-medium text-slate-950">
                {dashboard.profile.customerNumber}
              </dd>
            </div>
          </dl>
        </Panel>
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <Panel title="Outstanding balance">
          <p className="text-3xl font-bold text-slate-950">
            {formatMoney(dashboard.outstandingInvoiceCents)}
          </p>
          <p className="mt-2 text-sm text-slate-500">Issued and overdue invoices.</p>
        </Panel>
        <Panel title="Latest invoice">
          {dashboard.latestInvoice ? (
            <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
              <div>
                <p className="font-semibold text-slate-950">
                  {dashboard.latestInvoice.invoiceNumber}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Due {formatDate(dashboard.latestInvoice.dueDate)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Invoice status</p>
                <div className="mt-1">
                  <StatusBadge status={dashboard.latestInvoice.status} />
                </div>
              </div>
              <div className="sm:text-right">
                <p className="font-semibold text-slate-950">
                  {formatMoney(dashboard.latestInvoice.totalCents)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Payment: {dashboard.latestInvoice.payment?.status ?? 'No payment recorded'}
                </p>
                {['ISSUED', 'OVERDUE'].includes(dashboard.latestInvoice.status) ? (
                  <StripeCheckoutButton invoiceId={dashboard.latestInvoice.id} />
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-slate-600">You do not have an invoice yet.</p>
          )}
        </Panel>
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="font-semibold text-slate-950">Invoice history</h2>
            <p className="mt-1 text-sm text-slate-500">Your five most recent invoices.</p>
          </div>
          <Link
            className="text-sm font-semibold text-sky-700 hover:text-sky-900"
            href="/customer/invoices"
          >
            View all invoices
          </Link>
        </div>
        {dashboard.invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">Invoice</th>
                  <th className="px-6 py-3">Issue date</th>
                  <th className="px-6 py-3">Invoice status</th>
                  <th className="px-6 py-3">Payment status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-right">Document</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.invoices.map((invoice) => (
                  <InvoiceRow invoice={invoice} key={invoice.id} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-6 py-8 text-slate-600">You do not have any invoices yet.</p>
        )}
      </section>
    </main>
  );
}

export function InvoiceRow({ invoice }: Readonly<{ invoice: CustomerInvoice }>) {
  const { accessToken } = useAuth();
  const [downloadError, setDownloadError] = useState(false);

  async function download() {
    if (!accessToken) return;
    setDownloadError(false);
    try {
      await apiDownload(`/invoices/${invoice.id}/pdf`, accessToken, `${invoice.invoiceNumber}.pdf`);
    } catch {
      setDownloadError(true);
    }
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-6 py-4 font-medium text-slate-900">{invoice.invoiceNumber}</td>
      <td className="px-6 py-4 text-slate-600">{formatDate(invoice.issueDate)}</td>
      <td className="px-6 py-4">
        <StatusBadge status={invoice.status} />
      </td>
      <td className="px-6 py-4 text-slate-600">{invoice.paymentStatus ?? 'No payment recorded'}</td>
      <td className="px-6 py-4 text-right font-medium text-slate-900">
        {formatMoney(invoice.totalCents)}
      </td>
      <td className="px-6 py-4 text-right">
        <button className="button-secondary" onClick={() => void download()} type="button">
          {downloadError ? 'Retry PDF' : 'Download PDF'}
        </button>
      </td>
    </tr>
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
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    PENDING: 'bg-sky-100 text-sky-800',
    SUSPENDED: 'bg-amber-100 text-amber-800',
    CANCELLED: 'bg-slate-100 text-slate-700',
    PAID: 'bg-emerald-100 text-emerald-800',
    ISSUED: 'bg-sky-100 text-sky-800',
    OVERDUE: 'bg-amber-100 text-amber-800',
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
