'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  DataTableControls,
  DataTablePagination,
  TableSkeleton,
  useTableQueryParams,
  type PageMeta,
} from '../../../components/data-table';

import { useAuth } from '../../../features/auth/auth-provider';
import { usePlanOptions } from '../../../features/plans/use-plan-options';
import { ApiError, apiRequest } from '../../../lib/api/client';
import { statusToneClass } from '../../../lib/status-theme';

type Customer = { id: string; customerNumber?: string; firstName: string; lastName: string };
type Subscription = {
  id: string;
  status:
    | 'PENDING'
    | 'ACTIVE'
    | 'PAST_DUE'
    | 'CANCELLATION_PENDING'
    | 'DISCONNECTION_PENDING'
    | 'SUSPENDED'
    | 'CANCELLED'
    | 'TERMINATED';
  startDate: string;
  currentPeriodEnd: string;
  billingMode: 'MANUAL' | 'STRIPE_RECURRING';
  stripeStatus: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodType: 'CARD' | 'AU_BECS_DEBIT' | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodExpMonth: number | null;
  paymentMethodExpYear: number | null;
  pastDueAt: string | null;
  gracePeriodEndsAt: string | null;
  suspendedAt: string | null;
  suspensionReason: 'NON_PAYMENT' | 'ADMINISTRATIVE' | 'FRAUD' | 'COMPLIANCE' | 'OTHER' | null;
  eligibleForTerminationAt: string | null;
  provisioningStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | null;
  provisioningFailure: string | null;
  remindersSent: number;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    totalCents: number;
    dueDate: string;
    status: 'ISSUED' | 'OVERDUE';
    payments: Array<{ status: string; createdAt: string }>;
  }>;
  customer: Customer & {
    supportCases: Array<{ id: string; caseNumber: string; subject: string; status: string }>;
  };
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
  const planOptions = usePlanOptions(
    accessToken,
    Boolean(user && ['SUPER_ADMIN', 'ADMIN', 'STAFF'].includes(user.role)),
  );
  const table = useTableQueryParams([
    'status',
    'planId',
    'billingCycle',
    'paymentStatus',
    'activatedFrom',
    'activatedTo',
    'cancelled',
    'pendingPlanChange',
    'lifecycle',
  ]);
  const changeTable = useTableQueryParams(['status', 'type'], 'changes_');

  const subscriptions = useQuery({
    queryKey: ['subscriptions', table.query],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest<{ data: Subscription[]; meta: PageMeta }>(
        `/subscriptions?${table.query}`,
        {},
        accessToken,
      ),
    enabled: Boolean(
      accessToken &&
      (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'STAFF'),
    ),
  });
  const planChanges = useQuery({
    queryKey: ['plan-change-requests', changeTable.query],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const query = new URLSearchParams({
        page: String(changeTable.page),
        limit: String(changeTable.limit),
      });
      if (changeTable.values.status) query.set('status', changeTable.values.status);
      if (changeTable.values.type) query.set('type', changeTable.values.type);
      return apiRequest<{ data: PlanChange[]; meta: PageMeta }>(
        `/plan-change-requests?${query.toString()}`,
        {},
        accessToken,
      );
    },
    enabled: Boolean(
      accessToken &&
      (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'STAFF'),
    ),
  });
  const transition = useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'suspend' | 'reactivate' | 'extend-grace-period' | 'terminate';
      body?: Record<string, unknown>;
    }) =>
      apiRequest<Subscription>(
        `/subscriptions/${id}/${action}`,
        { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) },
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
      <main className="grid min-h-screen place-items-center text-muted-foreground">
        Checking your session…
      </main>
    );
  }
  if (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return (
      <main className="grid min-h-screen place-items-center text-muted-foreground">
        Staff or administrator access is required.
      </main>
    );
  }
  const error = transition.error;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="border-b border-border pb-6">
        <div>
          <p className="text-sm font-semibold tracking-wide text-primary">ADMIN · OPERATIONS</p>
          <h1 className="mt-2 text-3xl font-bold">Subscriptions</h1>
          <p className="mt-2 text-muted-foreground">
            Review service history, lifecycle status, and customer-requested plan changes.
          </p>
        </div>
      </header>

      {subscriptions.isError || planChanges.isError ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-destructive-subtle p-4 text-sm text-destructive-foreground">
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
        <p className="mt-6 rounded-md bg-destructive-subtle p-4 text-sm text-destructive-foreground">
          {error instanceof ApiError ? error.message : 'Unable to update subscription.'}
        </p>
      ) : null}

      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <h2 className="font-semibold">Subscription history</h2>
        </div>
        <DataTableControls
          state={table}
          sorts={['createdAt', 'startDate', 'currentPeriodEnd', 'status']}
          placeholder="Search customer, email, account or subscription ID…"
          fields={[
            {
              key: 'status',
              label: 'Status',
              options: [
                'PENDING',
                'ACTIVE',
                'PAST_DUE',
                'CANCELLATION_PENDING',
                'DISCONNECTION_PENDING',
                'SUSPENDED',
                'CANCELLED',
                'TERMINATED',
              ],
            },
            { key: 'planId', label: 'Plan', options: planOptions },
            { key: 'billingCycle', label: 'Billing cycle', options: ['MONTHLY'] },
            {
              key: 'paymentStatus',
              label: 'Payment status',
              options: ['PENDING', 'SUCCEEDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
            },
            { key: 'activatedFrom', label: 'Service start from', type: 'date' },
            { key: 'activatedTo', label: 'Service start to', type: 'date' },
            { key: 'cancelled', label: 'Cancelled', options: ['true', 'false'] },
            { key: 'pendingPlanChange', label: 'Pending plan change', options: ['true', 'false'] },
            {
              key: 'lifecycle',
              label: 'Overdue lifecycle',
              options: ['GRACE_EXPIRING', 'ELIGIBLE_FOR_TERMINATION'],
            },
          ]}
        />
        {subscriptions.isPending ? <TableSkeleton /> : null}
        <div className="divide-y divide-border/70">
          {subscriptions.isError && (
            <p role="alert" className="p-6 text-destructive-foreground">
              Unable to load subscriptions. Check the filters and try again.
            </p>
          )}
          {subscriptions.data?.data.length === 0 && (
            <p className="p-6 text-muted-foreground">
              {table.values.search
                ? 'No subscriptions match your search.'
                : 'No subscriptions match the selected filters.'}
            </p>
          )}
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
                <p className="mt-1 text-sm text-muted-foreground">
                  {subscription.plan.name} · {subscription.plan.downloadMbps}/
                  {subscription.plan.uploadMbps} Mbps · starts {formatDate(subscription.startDate)}
                </p>
                {subscription.status === 'ACTIVE' && user.role !== 'STAFF' ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Current period ends {formatDateTime(subscription.currentPeriodEnd)}
                  </p>
                ) : null}
                {user.role !== 'STAFF' ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {subscription.billingMode === 'STRIPE_RECURRING'
                      ? `Automatic recurring payment · Stripe ${subscription.stripeStatus ?? 'synchronizing'} · ${adminPaymentMethod(subscription)} · ${
                          subscription.cancelAtPeriodEnd
                            ? 'cancels after current period'
                            : `next charge ${formatDateTime(subscription.nextBillingAt ?? subscription.currentPeriodEnd)}`
                        }`
                      : 'Manual billing · customer must enable automatic payments'}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {subscription.status === 'ACTIVE' ? (
                  <button
                    className="button-secondary"
                    disabled={transition.isPending}
                    onClick={() =>
                      transition.mutate({
                        id: subscription.id,
                        action: 'suspend',
                        body: { reason: 'ADMINISTRATIVE' },
                      })
                    }
                    type="button"
                  >
                    Suspend
                  </button>
                ) : null}
                {subscription.status === 'SUSPENDED' && user.role !== 'STAFF' ? (
                  <button
                    className="button-primary"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: subscription.id, action: 'reactivate' })}
                    type="button"
                  >
                    Reactivate
                  </button>
                ) : null}
                {subscription.status === 'PAST_DUE' ? (
                  <button
                    className="button-secondary"
                    disabled={transition.isPending || user.role === 'STAFF'}
                    onClick={() =>
                      transition.mutate({
                        id: subscription.id,
                        action: 'extend-grace-period',
                        body: { days: 3 },
                      })
                    }
                    title={
                      user.role === 'STAFF' ? 'Administrator permission is required.' : undefined
                    }
                    type="button"
                  >
                    Extend grace 3 days
                  </button>
                ) : null}
                {subscription.status === 'SUSPENDED' &&
                subscription.suspensionReason === 'NON_PAYMENT' &&
                subscription.eligibleForTerminationAt &&
                new Date(subscription.eligibleForTerminationAt) <= new Date() &&
                user.role === 'SUPER_ADMIN' ? (
                  <button
                    className="button-secondary text-destructive-foreground"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: subscription.id, action: 'terminate' })}
                    type="button"
                  >
                    Terminate
                  </button>
                ) : null}
                {subscription.status !== 'CANCELLED' ? (
                  <Link className="button-secondary" href="/control-centre/cancellations">
                    Manage cancellation
                  </Link>
                ) : null}
              </div>
              {subscription.invoices[0] ? (
                <dl className="grid w-full gap-2 rounded-lg bg-muted p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <dt className="text-xs text-muted-foreground">Invoice</dt>
                    <dd className="font-medium">{subscription.invoices[0].invoiceNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Amount due</dt>
                    <dd className="font-medium">
                      {formatMoney(subscription.invoices[0].totalCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Due date</dt>
                    <dd>{formatDate(subscription.invoices[0].dueDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Days overdue</dt>
                    <dd>
                      {Math.max(
                        0,
                        Math.floor(
                          (Date.now() - new Date(subscription.invoices[0].dueDate).getTime()) /
                            86_400_000,
                        ),
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Grace ends</dt>
                    <dd>
                      {subscription.gracePeriodEndsAt
                        ? formatDateTime(subscription.gracePeriodEndsAt)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Provisioning</dt>
                    <dd>
                      {subscription.provisioningStatus ?? 'Not requested'}
                      {subscription.provisioningFailure ? ' · needs review' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Payment attempts</dt>
                    <dd>
                      {subscription.invoices.reduce(
                        (total, invoice) => total + invoice.payments.length,
                        0,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Reminders sent</dt>
                    <dd>{subscription.remindersSent}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Support cases</dt>
                    <dd>{subscription.customer.supportCases.length || 'None'}</dd>
                  </div>
                </dl>
              ) : null}
            </article>
          ))}
        </div>
        <DataTablePagination
          state={table}
          meta={subscriptions.data?.meta}
          busy={subscriptions.isFetching}
          noun="subscriptions"
        />
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-5">
          <div>
            <h2 className="font-semibold">Plan-change requests</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Payment, scheduling, application, and failure visibility for operations.
            </p>
          </div>
        </div>
        <DataTableControls
          searchable={false}
          state={changeTable}
          fields={[
            {
              key: 'status',
              label: 'Status',
              options: [
                'PENDING',
                'CHECKOUT_CREATED',
                'PROCESSING',
                'SCHEDULED',
                'APPLIED',
                'FAILED',
                'CANCELLED',
                'EXPIRED',
              ],
            },
            { key: 'type', label: 'Type', options: ['UPGRADE', 'DOWNGRADE'] },
          ]}
        />
        {planChanges.isPending ? (
          <p className="p-6 text-muted-foreground">Loading plan changes…</p>
        ) : null}
        {planChanges.data?.data.length === 0 ? (
          <p className="p-6 text-muted-foreground">No plan changes match these filters.</p>
        ) : null}
        <div className="divide-y divide-border/70">
          {planChanges.data?.data.map((change) => (
            <article className="grid gap-4 p-6 lg:grid-cols-[1.2fr_1.2fr_1fr_auto]" key={change.id}>
              <div>
                <p className="font-semibold">
                  {change.customer.firstName} {change.customer.lastName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {change.currentPlan.name} → {change.targetPlan.name}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  Request {change.id.slice(0, 8)} ·{' '}
                  <Link
                    className="font-semibold text-primary underline"
                    href={`#subscription-${change.sourceSubscriptionId}`}
                  >
                    Source subscription {change.sourceSubscriptionId.slice(0, 8)}
                  </Link>
                </p>
                {change.newSubscriptionId ? (
                  <Link
                    className="mt-1 block font-mono text-xs font-semibold text-primary underline"
                    href={`#subscription-${change.newSubscriptionId}`}
                  >
                    Result subscription {change.newSubscriptionId.slice(0, 8)}
                  </Link>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground">
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
                  <p className="mt-1 text-destructive-foreground">
                    Reason: {change.failureReason.replaceAll('_', ' ')}
                  </p>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground">
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
                  <summary className="cursor-pointer font-semibold text-primary">
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
                <span className="rounded-full bg-primary-subtle px-2.5 py-1 text-xs font-semibold text-primary">
                  {change.type}
                </span>
                <StatusBadge status={change.status} />
                {change.invoice ? (
                  <Link
                    className="text-xs font-semibold text-primary underline"
                    href="/admin/invoices"
                  >
                    Invoice history
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        <DataTablePagination
          state={changeTable}
          meta={planChanges.data?.meta}
          busy={planChanges.isFetching}
          noun="plan changes"
        />
      </section>
    </main>
  );
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span
      className={`ml-2 rounded-full px-2 py-1 text-xs font-semibold ${statusToneClass(status)}`}
    >
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

function adminPaymentMethod(subscription: Subscription): string {
  if (!subscription.paymentMethodLast4) return 'payment method managed by Stripe';
  if (subscription.paymentMethodType === 'AU_BECS_DEBIT') {
    return `Direct Debit •••• ${subscription.paymentMethodLast4}`;
  }
  const brand = subscription.paymentMethodBrand ?? 'card';
  return `${brand} •••• ${subscription.paymentMethodLast4}`;
}
