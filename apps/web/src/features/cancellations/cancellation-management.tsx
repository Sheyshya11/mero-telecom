'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  DataTableControls,
  DataTablePagination,
  TableSkeleton,
  useTableQueryParams,
  type PageMeta,
} from '../../components/data-table';
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
import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

interface CancellationRecord {
  id: string;
  requestNumber: string;
  subscriptionId: string;
  type: 'END_OF_PERIOD' | 'IMMEDIATE';
  reason: string;
  reasonDetails: string | null;
  requestedAt: string;
  effectiveAt: string;
  status: string;
  providerOperation: string;
  requestedByRole: string;
  customer: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  subscription: { plan: { name: string; monthlyCents: number } };
  requestedBy: { displayName: string | null; email: string };
  notes: Array<{
    id: string;
    body: string;
    authorRole: string;
    createdAt: string;
    author: { displayName: string | null; email: string };
  }>;
  provider: {
    name: string;
    reference: string | null;
    status: string;
    simulated: boolean;
    lastCheckedAt: string | null;
    failureReason: string | null;
  };
  capabilities: { canRetry: boolean; canRevoke: boolean; canEscalate: boolean };
}

interface CancellationDetail extends CancellationRecord {
  timeline: Array<{
    id: string;
    action: string;
    createdAt: string;
    actor: { displayName: string | null; email: string } | null;
  }>;
}

export function CancellationManagement() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [retryScenario, setRetryScenario] = useState('PENDING');
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const table = useTableQueryParams(
    ['status', 'type', 'reason', 'dateFrom', 'dateTo'],
    '',
    'requestedAt',
  );
  const authorised = Boolean(user && ['STAFF', 'ADMIN', 'SUPER_ADMIN'].includes(user.role));
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const list = useQuery({
    queryKey: ['cancellations', table.query],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest<{ data: CancellationRecord[]; meta: PageMeta }>(
        `/admin/cancellations?${table.query}`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && authorised),
  });
  const summary = useQuery({
    queryKey: ['cancellation-summary'],
    queryFn: () =>
      apiRequest<{
        total: number;
        open: number;
        failed: number;
        immediate: number;
        endOfPeriod: number;
        providerSimulated: boolean;
      }>('/admin/cancellations/summary', {}, accessToken),
    enabled: Boolean(accessToken && authorised),
  });
  const detail = useQuery({
    queryKey: ['cancellation', selected],
    queryFn: () =>
      apiRequest<CancellationDetail>(`/admin/cancellations/${selected}`, {}, accessToken),
    enabled: Boolean(accessToken && authorised && selected),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cancellations'] }),
      queryClient.invalidateQueries({ queryKey: ['cancellation-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['cancellation', selected] }),
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
    ]);
  };
  const retry = useMutation({
    mutationFn: (requestNumber: string) =>
      apiRequest(
        `/admin/cancellations/${requestNumber}/retry`,
        {
          method: 'POST',
          body: JSON.stringify(
            detail.data?.provider.simulated ? { mockScenario: retryScenario } : {},
          ),
        },
        accessToken,
      ),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (requestNumber: string) =>
      apiRequest(`/admin/cancellations/${requestNumber}/revoke`, { method: 'POST' }, accessToken),
    onSuccess: async () => {
      setRevokeTarget(null);
      await refresh();
    },
  });
  const addNote = useMutation({
    mutationFn: (requestNumber: string) =>
      apiRequest(
        `/admin/cancellations/${requestNumber}/notes`,
        { method: 'POST', body: JSON.stringify({ body: note }) },
        accessToken,
      ),
    onSuccess: async () => {
      setNote('');
      await refresh();
    },
  });

  useEffect(() => {
    const requestNumber = new URLSearchParams(window.location.search).get('request')?.trim();
    if (requestNumber) setSelected(requestNumber);
  }, []);

  useEffect(() => {
    setNote('');
    retry.reset();
    revoke.reset();
    addNote.reset();
  }, [selected]);

  const selectRequest = (requestNumber: string | null) => {
    setSelected(requestNumber);
    const url = new URL(window.location.href);
    if (requestNumber) url.searchParams.set('request', requestNumber);
    else url.searchParams.delete('request');
    window.history.replaceState(window.history.state, '', url);
  };

  if (isLoading) return <Status text="Checking your session…" />;
  if (!authorised) return <Status text="Staff or administrator access is required." />;
  const actionError = retry.error ?? revoke.error ?? addNote.error;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-7xl px-6 py-10">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-sky-700">SERVICE OPERATIONS</p>
        <h1 className="mt-2 text-3xl font-bold">Service cancellations</h1>
        <p className="mt-2 text-slate-600">
          Track customer requests, provider processing, failures and service completion.
        </p>
      </header>

      {summary.data?.providerSimulated ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Mock wholesale provider is active. These provider results are internal simulations and do
          not represent real NBN disconnections.
        </p>
      ) : null}
      {summary.isError ? (
        <p className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          Cancellation totals are temporarily unavailable.
        </p>
      ) : null}
      <section
        className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Cancellation summary"
      >
        <Metric label="Open requests" value={summary.data?.open} />
        <Metric label="Failed / review" value={summary.data?.failed} />
        <Metric label="Immediate" value={summary.data?.immediate} />
        <Metric label="End of period" value={summary.data?.endOfPeriod} />
      </section>

      {actionError ? (
        <p className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {actionError instanceof ApiError
            ? actionError.message
            : 'The cancellation action could not be completed.'}
        </p>
      ) : null}

      <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="font-semibold">Cancellation requests</h2>
        </div>
        <DataTableControls
          state={table}
          sorts={['requestedAt', 'createdAt', 'effectiveAt', 'status', 'updatedAt']}
          placeholder="Search request, customer, email or service ID…"
          fields={[
            {
              key: 'status',
              label: 'Status',
              options: [
                'REQUESTED',
                'SCHEDULED',
                'PROCESSING',
                'DISCONNECTION_PENDING',
                'COMPLETED',
                'FAILED',
                'REVOKED',
              ],
            },
            { key: 'type', label: 'Type', options: ['END_OF_PERIOD', 'IMMEDIATE'] },
            {
              key: 'reason',
              label: 'Reason',
              options: [
                'MOVING_HOME',
                'SWITCHING_PROVIDER',
                'PRICE',
                'SERVICE_QUALITY',
                'CONNECTION_PROBLEMS',
                'NO_LONGER_REQUIRED',
                'OTHER',
              ],
            },
            { key: 'dateFrom', label: 'Requested from', type: 'date' },
            { key: 'dateTo', label: 'Requested to', type: 'date' },
          ]}
        />
        {list.isPending ? <TableSkeleton /> : null}
        {list.isError ? (
          <div className="p-6 text-rose-700" role="alert">
            <p>Unable to load cancellations.</p>
            <button className="mt-2 font-semibold underline" onClick={() => list.refetch()} type="button">
              Try again
            </button>
          </div>
        ) : null}
        {list.data?.data.length === 0 ? (
          <p className="p-6 text-slate-600">No cancellation requests match these filters.</p>
        ) : null}
        <div className="divide-y divide-slate-100">
          {list.data?.data.map((request) => (
            <article
              className="grid gap-4 p-6 lg:grid-cols-[1.1fr_1.3fr_1fr_1fr_auto]"
              key={request.id}
            >
              <div>
                <p className="font-mono text-sm font-semibold text-sky-800">
                  {request.requestNumber}
                </p>
                <p className="mt-1 text-xs text-slate-500">{humanize(request.type)}</p>
              </div>
              <div>
                <p className="font-semibold">
                  {request.customer.firstName} {request.customer.lastName}
                </p>
                <p className="text-sm text-slate-600">{request.customer.email}</p>
                <p className="font-mono text-xs text-slate-500">
                  {request.customer.customerNumber}
                </p>
              </div>
              <div className="text-sm text-slate-600">
                <p>{request.subscription.plan.name}</p>
                <p>{formatMoney(request.subscription.plan.monthlyCents)}/month</p>
                <p className="font-mono text-xs">{request.subscriptionId.slice(0, 8)}</p>
              </div>
              <div className="text-sm text-slate-600">
                <p>Requested {formatDateTime(request.requestedAt)}</p>
                <p>Effective {formatDateTime(request.effectiveAt)}</p>
                <p>Provider: {humanize(request.provider.status)}</p>
              </div>
              <div className="flex flex-col items-start gap-2 lg:items-end">
                <Badge value={request.status} />
                <button
                  className="text-sm font-semibold text-sky-700 underline"
                  onClick={() => selectRequest(request.requestNumber)}
                  type="button"
                >
                  Review
                </button>
              </div>
            </article>
          ))}
        </div>
        <DataTablePagination
          state={table}
          meta={list.data?.meta}
          busy={list.isFetching}
          noun="cancellations"
        />
      </section>

      {selected ? (
        <section
          className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          aria-labelledby="cancellation-detail-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-sm font-semibold text-sky-800">{selected}</p>
              <h2 className="mt-1 text-2xl font-bold" id="cancellation-detail-title">
                Cancellation review
              </h2>
            </div>
            <button className="button-secondary" onClick={() => selectRequest(null)} type="button">
              Close details
            </button>
          </div>
          {detail.isPending ? (
            <p className="mt-5 text-slate-600">Loading cancellation details…</p>
          ) : null}
          {detail.isError ? (
            <div className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">
              <p>Unable to load this cancellation request.</p>
              <button className="mt-2 font-semibold underline" onClick={() => detail.refetch()} type="button">
                Try again
              </button>
            </div>
          ) : null}
          {detail.data ? (
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-semibold">Cancellation summary</h3>
                <dl className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                  <Fact
                    label="Customer"
                    value={`${detail.data.customer.firstName} ${detail.data.customer.lastName}`}
                  />
                  <Fact label="Plan" value={detail.data.subscription.plan.name} />
                  <Fact label="Reason" value={humanize(detail.data.reason)} />
                  <Fact
                    label="Requested by"
                    value={`${detail.data.requestedBy.displayName ?? detail.data.requestedBy.email} · ${humanize(detail.data.requestedByRole)}`}
                  />
                  <Fact label="Effective" value={formatDateTime(detail.data.effectiveAt)} />
                  <Fact label="Operation" value={humanize(detail.data.providerOperation)} />
                </dl>
                {detail.data.reasonDetails ? (
                  <p className="mt-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
                    {detail.data.reasonDetails}
                  </p>
                ) : null}
                <h3 className="mt-6 font-semibold">Provider / network</h3>
                <dl className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  <Fact
                    label="Provider"
                    value={`${detail.data.provider.name}${detail.data.provider.simulated ? ' · SIMULATION' : ''}`}
                  />
                  <Fact label="Provider status" value={humanize(detail.data.provider.status)} />
                  <Fact
                    label="Provider reference"
                    value={detail.data.provider.reference ?? 'Not submitted'}
                  />
                  <Fact
                    label="Last checked"
                    value={
                      detail.data.provider.lastCheckedAt
                        ? formatDateTime(detail.data.provider.lastCheckedAt)
                        : 'Not checked'
                    }
                  />
                </dl>
                {detail.data.provider.failureReason ? (
                  <p className="mt-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">
                    {detail.data.provider.failureReason}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-3">
                  {canManage &&
                  detail.data.capabilities.canRetry &&
                  detail.data.provider.simulated ? (
                    <label className="text-sm font-medium text-slate-700">
                      Retry scenario
                      <select
                        className="field mt-1 block"
                        onChange={(event) => setRetryScenario(event.target.value)}
                        value={retryScenario}
                      >
                        <option value="PENDING">Pending, then complete</option>
                        <option value="SUCCESS">Complete immediately</option>
                        <option value="FAILED">Simulate failure</option>
                        <option value="MANUAL_REVIEW_REQUIRED">Manual review required</option>
                      </select>
                    </label>
                  ) : null}
                  {canManage && detail.data.capabilities.canRetry ? (
                    <button
                      className="button-primary"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(detail.data.requestNumber)}
                      type="button"
                    >
                      {retry.isPending ? 'Retrying…' : 'Retry'}
                    </button>
                  ) : null}
                  {canManage && detail.data.capabilities.canRevoke ? (
                    <button
                      className="button-secondary"
                      disabled={revoke.isPending}
                      onClick={() => setRevokeTarget(detail.data.requestNumber)}
                      type="button"
                    >
                      Revoke
                    </button>
                  ) : null}
                  {detail.data.capabilities.canEscalate ? (
                    <Link
                      className="button-secondary"
                      href={`/control-centre/internal-requests/new?customerId=${encodeURIComponent(detail.data.customer.id)}&subscriptionId=${encodeURIComponent(detail.data.subscriptionId)}&type=SUBSCRIPTION_ACTION&title=${encodeURIComponent(`Cancellation ${detail.data.requestNumber} requires review`)}`}
                    >
                      Escalate
                    </Link>
                  ) : null}
                </div>
              </div>
              <div>
                <h3 className="font-semibold">Timeline</h3>
                <ol className="mt-3 space-y-3 border-l border-slate-200 pl-5">
                  {detail.data.timeline.map((event) => (
                    <li key={event.id}>
                      <p className="text-sm font-semibold">{humanize(event.action)}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(event.createdAt)} ·{' '}
                        {event.actor?.displayName ?? event.actor?.email ?? 'System'}
                      </p>
                    </li>
                  ))}
                </ol>
                <h3 className="mt-6 font-semibold">Internal notes</h3>
                <div className="mt-3 space-y-3">
                  {detail.data.notes.length ? (
                    detail.data.notes.map((item) => (
                      <article className="rounded-xl bg-slate-50 p-4" key={item.id}>
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{item.body}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {item.author.displayName ?? item.author.email} ·{' '}
                          {humanize(item.authorRole)} · {formatDateTime(item.createdAt)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No internal notes.</p>
                  )}
                </div>
                <label className="mt-4 block text-sm font-medium" htmlFor="cancellation-note">
                  Add internal note
                </label>
                <textarea
                  className="field mt-1 min-h-24"
                  id="cancellation-note"
                  maxLength={2000}
                  onChange={(event) => setNote(event.target.value)}
                  value={note}
                />
                <button
                  className="button-secondary mt-3"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() => addNote.mutate(detail.data.requestNumber)}
                  type="button"
                >
                  {addNote.isPending ? 'Adding…' : 'Add note'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this scheduled cancellation?</AlertDialogTitle>
            <AlertDialogDescription>
              The service will remain active and its existing billing cycle will continue. This is
              only available before provider processing starts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.isPending || !revokeTarget}
              onClick={() => revokeTarget && revoke.mutate(revokeTarget)}
            >
              {revoke.isPending ? 'Revoking…' : 'Revoke cancellation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value?: number }>) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value ?? '—'}</p>
    </article>
  );
}
function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
function Badge({ value }: Readonly<{ value: string }>) {
  const tone =
    value === 'COMPLETED'
      ? 'bg-emerald-100 text-emerald-800'
      : value === 'FAILED'
        ? 'bg-rose-100 text-rose-800'
        : value === 'SCHEDULED'
          ? 'bg-amber-100 text-amber-900'
          : value === 'REVOKED'
            ? 'bg-slate-100 text-slate-700'
            : 'bg-sky-100 text-sky-800';
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {humanize(value)}
    </span>
  );
}
function Status({ text }: Readonly<{ text: string }>) {
  return <main className="grid min-h-screen place-items-center text-slate-600">{text}</main>;
}
function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
