'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '../../../features/auth/auth-provider';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Customer = { id: string; customerNumber?: string; firstName: string; lastName: string };
type Subscription = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startDate: string;
  currentPeriodEnd: string;
  customer: Customer;
  plan: {
    id: string;
    name: string;
    downloadMbps: number;
    uploadMbps: number;
    monthlyCents: number;
  };
};

type PlanChange = {
  id: string;
  sourceSubscriptionId: string;
  newSubscriptionId: string | null;
  type: 'UPGRADE' | 'DOWNGRADE';
  status:
    | 'PENDING'
    | 'CHECKOUT_CREATED'
    | 'PROCESSING'
    | 'SCHEDULED'
    | 'APPLIED'
    | 'FAILED'
    | 'CANCELLED'
    | 'EXPIRED';
  amountPayableCents: number;
  currency: string;
  requestedAt: string;
  effectiveAt: string;
  failureReason: string | null;
  customer: Customer;
  currentPlan: { name: string };
  targetPlan: { name: string };
  invoice: { id: string; invoiceNumber: string; status: string } | null;
  payment: { id: string; status: string } | null;
  auditHistory: Array<{
    id: string;
    action: string;
    createdAt: string;
    actorUserId: string | null;
  }>;
};

export default function AdminSubscriptionsPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const subscriptions = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () =>
      apiRequest<{ data: Subscription[] }>('/subscriptions?limit=100', {}, accessToken),
    enabled: Boolean(accessToken && (user?.role === 'ADMIN' || user?.role === 'STAFF')),
  });
  const planChanges = useQuery({
    queryKey: ['plan-change-requests', statusFilter, typeFilter],
    queryFn: () => {
      const query = new URLSearchParams({ limit: '100' });
      if (statusFilter) query.set('status', statusFilter);
      if (typeFilter) query.set('type', typeFilter);
      return apiRequest<{ data: PlanChange[] }>(
        `/plan-change-requests?${query.toString()}`,
        {},
        accessToken,
      );
    },
    enabled: Boolean(accessToken && (user?.role === 'ADMIN' || user?.role === 'STAFF')),
  });
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Subscription['status'] }) =>
      apiRequest<Subscription>(
        `/subscriptions/${id}`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
        accessToken,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['plan-change-requests'] }),
      ]);
    },
  });

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Checking your session…
      </main>
    );
  }
  if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Staff or administrator access is required.
      </main>
    );
  }
  const error = transition.error;

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">
          MERO TELECOM · OPERATIONS
        </p>
        <h1 className="mt-2 text-3xl font-bold">Subscriptions</h1>
        <p className="mt-2 text-slate-600">
          Review service history, lifecycle status, and customer-requested plan changes.
        </p>
      </header>

      {subscriptions.isError || planChanges.isError ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
          <p>Some subscription or plan-change data could not be loaded.</p>
          <button
            className="button-secondary"
            onClick={() => {
              void subscriptions.refetch();
              void planChanges.refetch();
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
          {error instanceof ApiError ? error.message : 'Unable to update subscription.'}
        </p>
      ) : null}

      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="font-semibold">Subscription history</h2>
        </div>
        {subscriptions.isPending ? (
          <p className="p-6 text-slate-600">Loading subscriptions…</p>
        ) : null}
        <div className="divide-y divide-slate-100">
          {subscriptions.data?.data.map((subscription) => (
            <article
              className="flex flex-wrap items-center justify-between gap-4 p-6"
              id={`subscription-${subscription.id}`}
              key={subscription.id}
            >
              <div>
                <p className="font-semibold">
                  {subscription.customer.firstName} {subscription.customer.lastName}{' '}
                  <StatusBadge status={subscription.status} />
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {subscription.plan.name} · {subscription.plan.downloadMbps}/
                  {subscription.plan.uploadMbps} Mbps · starts {formatDate(subscription.startDate)}
                </p>
                {subscription.status === 'ACTIVE' ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Current period ends {formatDateTime(subscription.currentPeriodEnd)}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {subscription.status === 'ACTIVE' ? (
                  <button
                    className="button-secondary"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: subscription.id, status: 'SUSPENDED' })}
                    type="button"
                  >
                    Suspend
                  </button>
                ) : null}
                {subscription.status === 'SUSPENDED' ? (
                  <button
                    className="button-primary"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: subscription.id, status: 'ACTIVE' })}
                    type="button"
                  >
                    Reactivate
                  </button>
                ) : null}
                {subscription.status !== 'CANCELLED' ? (
                  <button
                    className="button-secondary"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: subscription.id, status: 'CANCELLED' })}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="font-semibold">Plan-change requests</h2>
            <p className="mt-1 text-sm text-slate-600">
              Payment, scheduling, application, and failure visibility for operations.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-slate-700">
              Status
              <select
                className="field mt-1 min-w-44"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="">All statuses</option>
                {[
                  'PENDING',
                  'CHECKOUT_CREATED',
                  'PROCESSING',
                  'SCHEDULED',
                  'APPLIED',
                  'FAILED',
                  'CANCELLED',
                  'EXPIRED',
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Type
              <select
                className="field mt-1 min-w-40"
                onChange={(event) => setTypeFilter(event.target.value)}
                value={typeFilter}
              >
                <option value="">All types</option>
                <option value="UPGRADE">Upgrade</option>
                <option value="DOWNGRADE">Downgrade</option>
              </select>
            </label>
          </div>
        </div>
        {planChanges.isPending ? <p className="p-6 text-slate-600">Loading plan changes…</p> : null}
        {planChanges.data?.data.length === 0 ? (
          <p className="p-6 text-slate-600">No plan changes match these filters.</p>
        ) : null}
        <div className="divide-y divide-slate-100">
          {planChanges.data?.data.map((change) => (
            <article className="grid gap-4 p-6 lg:grid-cols-[1.2fr_1.2fr_1fr_auto]" key={change.id}>
              <div>
                <p className="font-semibold">
                  {change.customer.firstName} {change.customer.lastName}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {change.currentPlan.name} → {change.targetPlan.name}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  Request {change.id.slice(0, 8)} ·{' '}
                  <Link
                    className="font-semibold text-sky-700 underline"
                    href={`#subscription-${change.sourceSubscriptionId}`}
                  >
                    Source subscription {change.sourceSubscriptionId.slice(0, 8)}
                  </Link>
                </p>
                {change.newSubscriptionId ? (
                  <Link
                    className="mt-1 block font-mono text-xs font-semibold text-sky-700 underline"
                    href={`#subscription-${change.newSubscriptionId}`}
                  >
                    Result subscription {change.newSubscriptionId.slice(0, 8)}
                  </Link>
                ) : null}
              </div>
              <div className="text-sm text-slate-600">
                <p>
                  Requested {formatDateTime(change.requestedAt)} · effective{' '}
                  {formatDateTime(change.effectiveAt)}
                </p>
                <p className="mt-1">
                  {change.type === 'UPGRADE'
                    ? `${formatMoney(change.amountPayableCents)} ${change.currency}`
                    : 'No immediate charge'}
                </p>
                {change.failureReason ? (
                  <p className="mt-1 text-rose-700">
                    Reason: {change.failureReason.replaceAll('_', ' ')}
                  </p>
                ) : null}
              </div>
              <div className="text-sm text-slate-600">
                <p>Invoice: {change.invoice?.invoiceNumber ?? '—'}</p>
                <p>Invoice status: {change.invoice?.status ?? '—'}</p>
                <p>
                  Payment:{' '}
                  {change.payment?.status ??
                    (change.type === 'UPGRADE' ? 'Awaiting Checkout' : 'Not required')}
                </p>
                {change.payment ? (
                  <p className="font-mono text-xs">Payment ID: {change.payment.id.slice(0, 8)}</p>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold text-sky-700">
                    Audit history ({change.auditHistory.length})
                  </summary>
                  {change.auditHistory.length ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {change.auditHistory.map((audit) => (
                        <li key={audit.id}>
                          {audit.action.replaceAll('_', ' ')} · {formatDateTime(audit.createdAt)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs">No request audit events recorded.</p>
                  )}
                </details>
              </div>
              <div className="flex items-start gap-2 lg:flex-col lg:items-end">
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                  {change.type}
                </span>
                <StatusBadge status={change.status} />
                {change.invoice ? (
                  <Link
                    className="text-xs font-semibold text-sky-700 underline"
                    href="/admin/invoices"
                  >
                    Invoice history
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-AU');
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}
