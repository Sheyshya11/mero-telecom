'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { ApiError, apiDownload, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import type { Invoice, InvoiceList, InvoiceStatus, InvoiceSubscription } from './invoice.types';

const generateSchema = z.object({
  subscriptionId: z.string().uuid('Select an active subscription.'),
  issueDate: z.string().date('Select a valid billing date.'),
});

type GenerateValues = z.infer<typeof generateSchema>;

export function InvoiceManagement() {
  const { accessToken, isLoading, logout, user } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null);
  const form = useForm<GenerateValues>({
    resolver: zodResolver(generateSchema),
    defaultValues: { subscriptionId: '', issueDate: new Date().toISOString().slice(0, 10) },
  });

  const canOperate = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const invoices = useQuery({
    queryKey: ['invoices', 'operations'],
    queryFn: () => apiRequest<InvoiceList>('/invoices?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && canOperate),
  });
  const subscriptions = useQuery({
    queryKey: ['subscriptions', 'invoice-options'],
    queryFn: () =>
      apiRequest<{ data: InvoiceSubscription[] }>('/subscriptions?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && canOperate),
  });

  const generate = useMutation({
    mutationFn: (values: GenerateValues) =>
      apiRequest<Invoice>(
        '/invoices/generate',
        { method: 'POST', body: JSON.stringify(values) },
        accessToken,
      ),
    onSuccess: async (invoice) => {
      setActionError(null);
      setNotice(`${invoice.invoiceNumber} was generated successfully.`);
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: showError,
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InvoiceStatus }) =>
      apiRequest<Invoice>(
        `/invoices/${id}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        accessToken,
      ),
    onSuccess: async (invoice) => {
      setActionError(null);
      setNotice(`${invoice.invoiceNumber} is now ${invoice.status.toLowerCase()}.`);
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: showError,
  });
  const sendEmail = useMutation({
    mutationFn: (invoice: Invoice) =>
      apiRequest<{ status: 'sent' | 'already_sent'; recipient: string }>(
        `/invoices/${invoice.id}/send`,
        { method: 'POST' },
        accessToken,
      ).then((result) => ({ invoice, result })),
    onSuccess: ({ invoice, result }) => {
      setActionError(null);
      setNotice(
        result.status === 'sent'
          ? `${invoice.invoiceNumber} was emailed to ${result.recipient}.`
          : `${invoice.invoiceNumber} was already emailed to ${result.recipient}.`,
      );
    },
    onError: showError,
  });

  function showError(reason: Error) {
    setNotice(null);
    setActionError(reason instanceof ApiError ? reason.message : 'The invoice action failed.');
  }

  async function download(invoice: Invoice) {
    if (!accessToken) return;
    setActionError(null);
    try {
      await apiDownload(`/invoices/${invoice.id}/pdf`, accessToken, `${invoice.invoiceNumber}.pdf`);
    } catch (reason) {
      showError(reason as Error);
    }
  }

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user || !canOperate) return <Status message="Staff or administrator access is required." />;

  const activeSubscriptions =
    subscriptions.data?.data.filter((subscription) => subscription.status === 'ACTIVE') ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · BILLING</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-2 text-slate-600">Generate, review, deliver, and download invoices.</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Operations">
          <Link
            className="button-secondary"
            href={user.role === 'ADMIN' ? '/admin/dashboard' : '/staff/customers'}
          >
            {user.role === 'ADMIN' ? 'Dashboard' : 'Customers'}
          </Link>
          <Link className="button-secondary" href="/admin/subscriptions">
            Subscriptions
          </Link>
          <button className="button-secondary" onClick={() => void logout()} type="button">
            Sign out
          </button>
        </nav>
      </header>

      {notice ? (
        <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Generate monthly invoice</h2>
        <form
          className="mt-5 grid gap-4 lg:grid-cols-[1fr_14rem_auto] lg:items-end"
          onSubmit={form.handleSubmit((values) => generate.mutate(values))}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            Active subscription
            <select className="field" {...form.register('subscriptionId')}>
              <option value="">Select subscription</option>
              {activeSubscriptions.map((subscription) => (
                <option key={subscription.id} value={subscription.id}>
                  {subscription.customer.customerNumber} — {subscription.customer.firstName}{' '}
                  {subscription.customer.lastName} — {subscription.plan.name}
                </option>
              ))}
            </select>
            {form.formState.errors.subscriptionId ? (
              <span className="text-xs text-rose-700">
                {form.formState.errors.subscriptionId.message}
              </span>
            ) : null}
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Billing date
            <input className="field" type="date" {...form.register('issueDate')} />
            {form.formState.errors.issueDate ? (
              <span className="text-xs text-rose-700">
                {form.formState.errors.issueDate.message}
              </span>
            ) : null}
          </label>
          <button className="button-primary" disabled={generate.isPending} type="submit">
            {generate.isPending ? 'Generating…' : 'Generate invoice'}
          </button>
        </form>
        {!subscriptions.isPending && activeSubscriptions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No active subscriptions are available for billing.
          </p>
        ) : null}
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="font-semibold">Invoice register</h2>
          <button
            className="button-secondary"
            onClick={() => void invoices.refetch()}
            type="button"
          >
            Refresh
          </button>
        </div>
        {invoices.isPending ? <p className="p-6 text-slate-600">Loading invoices…</p> : null}
        {invoices.isError ? <p className="p-6 text-rose-700">Unable to load invoices.</p> : null}
        {invoices.data?.data.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-250 text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Issued</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.data.map((invoice) => (
                  <tr className="border-b border-slate-100 last:border-0" key={invoice.id}>
                    <td className="px-5 py-4 font-semibold">{invoice.invoiceNumber}</td>
                    <td className="px-5 py-4">
                      <p>
                        {invoice.customer.firstName} {invoice.customer.lastName}
                      </p>
                      <p className="text-xs text-slate-500">{invoice.customer.customerNumber}</p>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {new Date(invoice.issueDate).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {new Intl.NumberFormat('en-AU', {
                        style: 'currency',
                        currency: invoice.currency,
                      }).format(invoice.totalCents / 100)}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          className="button-secondary"
                          onClick={() => void download(invoice)}
                          type="button"
                        >
                          PDF
                        </button>
                        {!['DRAFT', 'CANCELLED'].includes(invoice.status) ? (
                          <button
                            className="button-secondary"
                            disabled={sendEmail.isPending}
                            onClick={() => sendEmail.mutate(invoice)}
                            type="button"
                          >
                            Email
                          </button>
                        ) : null}
                        {user.role === 'ADMIN' && invoice.status === 'ISSUED' ? (
                          <button
                            className="button-secondary"
                            onClick={() =>
                              updateStatus.mutate({ id: invoice.id, status: 'OVERDUE' })
                            }
                            type="button"
                          >
                            Mark overdue
                          </button>
                        ) : null}
                        {user.role === 'ADMIN' &&
                        ['DRAFT', 'ISSUED', 'OVERDUE'].includes(invoice.status) ? (
                          <button
                            className="button-secondary text-rose-700"
                            onClick={() => setInvoiceToCancel(invoice)}
                            type="button"
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !invoices.isPending && !invoices.isError ? (
          <p className="p-6 text-slate-600">No invoices have been generated.</p>
        ) : null}
      </section>
      <AlertDialog
        open={Boolean(invoiceToCancel)}
        onOpenChange={(open) => {
          if (!open) setInvoiceToCancel(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {invoiceToCancel?.invoiceNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              This invoice will no longer be payable or emailable. This status change cannot be
              reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (invoiceToCancel)
                  updateStatus.mutate({ id: invoiceToCancel.id, status: 'CANCELLED' });
                setInvoiceToCancel(null);
              }}
            >
              Cancel invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      {message}
    </main>
  );
}
