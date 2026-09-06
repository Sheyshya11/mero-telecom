'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DataTableControls,
  DataTablePagination,
  TableSkeleton,
  useTableQueryParams,
  type PageMeta,
} from '../../components/data-table';
import { useEffect, useId, useState } from 'react';
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
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const table = useTableQueryParams(['status', 'dateFrom', 'dateTo', 'minAmount', 'maxAmount']);
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [subscriptionQuery, setSubscriptionQuery] = useState('');
  const [selectedSubscription, setSelectedSubscription] = useState<InvoiceSubscription | null>(
    null,
  );
  const [subscriptionPickerOpen, setSubscriptionPickerOpen] = useState(false);
  const [highlightedSubscription, setHighlightedSubscription] = useState(0);
  const subscriptionListId = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null);
  const form = useForm<GenerateValues>({
    resolver: zodResolver(generateSchema),
    defaultValues: { subscriptionId: '', issueDate: new Date().toISOString().slice(0, 10) },
  });

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const canOperate = isAdmin || user?.role === 'STAFF';
  useEffect(() => {
    if (selectedSubscription) return;
    const timer = setTimeout(() => setSubscriptionQuery(subscriptionSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [selectedSubscription, subscriptionSearch]);

  const invoices = useQuery({
    queryKey: ['invoices', 'operations', table.query],
    placeholderData: keepPreviousData,
    queryFn: () => apiRequest<InvoiceList>(`/invoices?${table.query}`, {}, accessToken),
    enabled: Boolean(accessToken && canOperate),
  });
  const subscriptions = useQuery({
    queryKey: ['subscriptions', 'invoice-options', subscriptionQuery],
    queryFn: () => {
      const params = new URLSearchParams({
        page: '1',
        limit: '50',
        status: 'ACTIVE',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      if (subscriptionQuery) params.set('search', subscriptionQuery);
      return apiRequest<{ data: InvoiceSubscription[]; meta: PageMeta }>(
        `/subscriptions?${params.toString()}`,
        {},
        accessToken,
      );
    },
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

  const activeSubscriptions = subscriptions.data?.data ?? [];
  const selectSubscription = (subscription: InvoiceSubscription) => {
    setSelectedSubscription(subscription);
    setSubscriptionSearch(subscriptionLabel(subscription));
    setSubscriptionPickerOpen(false);
    setHighlightedSubscription(0);
    form.setValue('subscriptionId', subscription.id, { shouldValidate: true });
  };

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM · BILLING</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-2 text-slate-600">Generate, review, deliver, and download invoices.</p>
        </div>
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
        <p className="mt-1 text-sm text-slate-600">
          Find the customer, select their active service, and choose the billing date.
        </p>
        <form
          className="mt-6 grid gap-x-4 gap-y-5 lg:grid-cols-[minmax(22rem,1fr)_14rem_auto] lg:items-start"
          onSubmit={form.handleSubmit((values) => generate.mutate(values))}
        >
          <div
            className="grid min-w-0 gap-1.5 text-sm font-medium"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setSubscriptionPickerOpen(false);
              }
            }}
          >
            <label htmlFor={`${subscriptionListId}-input`}>Active subscription</label>
            <div className="relative">
              <input
                aria-autocomplete="list"
                aria-controls={subscriptionListId}
                aria-expanded={subscriptionPickerOpen}
                aria-haspopup="listbox"
                className="field"
                id={`${subscriptionListId}-input`}
                onChange={(event) => {
                  setSelectedSubscription(null);
                  setSubscriptionSearch(event.target.value);
                  setSubscriptionPickerOpen(true);
                  setHighlightedSubscription(0);
                  form.setValue('subscriptionId', '');
                }}
                onFocus={() => setSubscriptionPickerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSubscriptionPickerOpen(true);
                    setHighlightedSubscription((current) =>
                      Math.min(current + 1, Math.max(activeSubscriptions.length - 1, 0)),
                    );
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setHighlightedSubscription((current) => Math.max(current - 1, 0));
                  } else if (event.key === 'Enter' && subscriptionPickerOpen) {
                    const highlighted = activeSubscriptions[highlightedSubscription];
                    if (highlighted) {
                      event.preventDefault();
                      selectSubscription(highlighted);
                    }
                  } else if (event.key === 'Escape') {
                    setSubscriptionPickerOpen(false);
                  }
                }}
                placeholder="Search name, email or account number"
                role="combobox"
                value={subscriptionSearch}
              />
              {subscriptionPickerOpen ? (
                <div
                  className="absolute top-full z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
                  id={subscriptionListId}
                  role="listbox"
                >
                  {subscriptions.isPending || subscriptions.isFetching ? (
                    <p className="px-3 py-3 text-sm font-normal text-slate-500">
                      Searching active subscriptions…
                    </p>
                  ) : subscriptions.isError ? (
                    <p className="px-3 py-3 text-sm font-normal text-rose-700">
                      Unable to load active subscriptions.
                    </p>
                  ) : activeSubscriptions.length ? (
                    activeSubscriptions.map((subscription, index) => (
                      <button
                        aria-selected={selectedSubscription?.id === subscription.id}
                        className={`grid w-full gap-0.5 rounded-lg px-3 py-2.5 text-left font-normal ${
                          index === highlightedSubscription
                            ? 'bg-teal-50 text-teal-950'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        key={subscription.id}
                        onClick={() => selectSubscription(subscription)}
                        onMouseEnter={() => setHighlightedSubscription(index)}
                        role="option"
                        type="button"
                      >
                        <span className="font-semibold text-slate-900">
                          {subscription.customer.firstName} {subscription.customer.lastName}
                        </span>
                        <span className="text-xs text-slate-500">
                          {subscription.customer.customerNumber} · {subscription.plan.name}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-3 text-sm font-normal text-slate-500">
                      No active subscriptions match this search.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <span className="min-h-4 text-xs font-normal text-slate-500" role="status">
              {selectedSubscription
                ? `${selectedSubscription.customer.customerNumber} selected.`
                : subscriptions.isFetching
                  ? 'Searching active subscriptions…'
                  : subscriptionQuery
                    ? `${subscriptions.data?.meta.total ?? 0} active subscription${subscriptions.data?.meta.total === 1 ? '' : 's'} found.`
                    : 'Type to search, then choose one active service.'}
            </span>
            {form.formState.errors.subscriptionId ? (
              <span className="text-xs text-rose-700">
                {form.formState.errors.subscriptionId.message}
              </span>
            ) : null}
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Billing date
            <input className="field" type="date" {...form.register('issueDate')} />
            {form.formState.errors.issueDate ? (
              <span className="text-xs text-rose-700">
                {form.formState.errors.issueDate.message}
              </span>
            ) : null}
          </label>
          <button
            className="button-primary w-full whitespace-nowrap lg:mt-[1.625rem] lg:min-w-40 lg:w-auto"
            disabled={generate.isPending}
            type="submit"
          >
            {generate.isPending ? 'Generating…' : 'Generate invoice'}
          </button>
        </form>
        {subscriptions.data && subscriptions.data.meta.total > activeSubscriptions.length ? (
          <p className="mt-4 text-sm text-slate-500">
            Showing the first {activeSubscriptions.length} matches. Refine the customer search to
            find another subscription.
          </p>
        ) : null}
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
        <DataTableControls
          state={table}
          sorts={['createdAt', 'issueDate', 'dueDate', 'totalCents']}
          placeholder="Search invoice number, customer, email or account…"
          fields={[
            {
              key: 'status',
              label: 'Status',
              options: [
                'DRAFT',
                'ISSUED',
                'PAID',
                'OVERDUE',
                'CANCELLED',
                'UNPAID',
                'REFUNDED',
                'PARTIALLY_REFUNDED',
              ],
            },
            { key: 'dateFrom', label: 'Invoice date from', type: 'date' },
            { key: 'dateTo', label: 'Invoice date to', type: 'date' },
            { key: 'minAmount', label: 'Minimum amount (cents)', type: 'number' },
            { key: 'maxAmount', label: 'Maximum amount (cents)', type: 'number' },
          ]}
        />
        {invoices.isPending ? <TableSkeleton /> : null}
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
                      {invoice.payments[0]?.refundedCents ? (
                        <p className="mt-2 text-xs text-slate-600">
                          Refunded:{' '}
                          {new Intl.NumberFormat('en-AU', {
                            style: 'currency',
                            currency: invoice.currency,
                          }).format(invoice.payments[0].refundedCents / 100)}
                        </p>
                      ) : null}
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
                        {isAdmin && invoice.status === 'ISSUED' ? (
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
                        {isAdmin && ['DRAFT', 'ISSUED', 'OVERDUE'].includes(invoice.status) ? (
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
      <DataTablePagination
        state={table}
        meta={invoices.data?.meta}
        busy={invoices.isFetching}
        noun="invoices"
      />
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

function subscriptionLabel(subscription: InvoiceSubscription) {
  return `${subscription.customer.firstName} ${subscription.customer.lastName} — ${subscription.customer.customerNumber} — ${subscription.plan.name}`;
}
