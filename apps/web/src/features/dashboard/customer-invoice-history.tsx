'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { InvoiceRow } from './customer-dashboard';
import type { CustomerInvoice } from './customer-dashboard.types';

type CustomerInvoiceApi = Omit<CustomerInvoice, 'paymentStatus' | 'payment'> & {
  payments: Array<NonNullable<CustomerInvoice['payment']>>;
};

interface InvoiceListResponse {
  data: CustomerInvoiceApi[];
  meta: { page: number; total: number; totalPages: number };
}

export function CustomerInvoiceHistory() {
  const { accessToken, isLoading, user } = useAuth();
  const invoicesQuery = useQuery({
    queryKey: ['customer-invoices'],
    queryFn: () => apiRequest<InvoiceListResponse>('/invoices/me?limit=50', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });

  if (isLoading) return <Status message="Restoring your session..." />;
  if (!user || user.role !== 'CUSTOMER') return <Status message="Customer access is required." />;
  if (invoicesQuery.isPending) return <Status message="Loading your invoices..." />;
  if (invoicesQuery.isError || !invoicesQuery.data)
    return (
      <Status
        message="Unable to load your invoice history."
        onRetry={() => void invoicesQuery.refetch()}
      />
    );
  const invoices = invoicesQuery.data.data.map((invoice) => ({
    ...invoice,
    paymentStatus: invoice.payments[0]?.status ?? null,
  }));

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Invoice history</h1>
          <p className="mt-2 text-slate-600">All invoices issued to your customer account.</p>
        </div>
        <Link className="button-secondary" href="/customer/dashboard">
          Back to dashboard
        </Link>
      </header>
      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {invoices.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">Invoice</th>
                  <th className="px-6 py-3">Issue date</th>
                  <th className="px-6 py-3">Invoice status</th>
                  <th className="px-6 py-3">Payment status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
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
