'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

type Policy = {
  firstReminderDays: number;
  secondReminderDays: number;
  finalWarningDays: number;
  suspensionDays: number;
};
const labels: Record<keyof Policy, string> = {
  firstReminderDays: 'First reminder',
  secondReminderDays: 'Second reminder',
  finalWarningDays: 'Final warning',
  suspensionDays: 'Suspend service after',
};
export function CollectionPolicyControls() {
  const { accessToken, user } = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['collection-policy'],
    queryFn: () => apiRequest<Policy>('/collections/policy', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'SUPER_ADMIN'),
  });
  const [draft, setDraft] = useState<Policy | null>(null);
  const save = useMutation({
    mutationFn: (policy: Policy) =>
      apiRequest(
        '/collections/policy',
        { method: 'PUT', body: JSON.stringify(policy) },
        accessToken,
      ),
    onSuccess: async () => {
      setDraft(null);
      await client.invalidateQueries({ queryKey: ['collection-policy'] });
    },
  });
  if (user?.role !== 'SUPER_ADMIN') return null;
  const policy = draft ?? query.data;
  if (!policy)
    return (
      <p className="mt-6" role="status">
        {query.isError ? 'Could not load overdue policy.' : 'Loading overdue policy…'}
      </p>
    );
  const valid = (Object.keys(labels) as Array<keyof Policy>).every(
    (key, index, keys) =>
      Number.isInteger(policy[key]) &&
      policy[key] > 0 &&
      policy[key] <= 365 &&
      (!index || policy[key] > policy[keys[index - 1]]),
  );
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-card p-6"
      aria-label="Overdue payment policy"
    >
      <h2 className="font-semibold">Overdue payment policy</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid)
            save.mutate({
              firstReminderDays: policy.firstReminderDays,
              secondReminderDays: policy.secondReminderDays,
              finalWarningDays: policy.finalWarningDays,
              suspensionDays: policy.suspensionDays,
            });
        }}
      >
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {(Object.keys(labels) as Array<keyof Policy>).map((key) => (
            <label key={key} className="text-sm">
              {labels[key]}
              <input
                aria-label={labels[key]}
                className="mt-1 w-full rounded border border-border bg-background p-2"
                type="number"
                min={1}
                max={365}
                value={policy[key]}
                onChange={(event) => setDraft({ ...policy, [key]: Number(event.target.value) })}
              />
              day(s) overdue
            </label>
          ))}
        </div>
        {!valid ? (
          <p className="mt-2 text-sm" role="alert">
            Use positive whole days in strictly increasing order.
          </p>
        ) : null}
        <button className="button-primary mt-4" disabled={!valid || save.isPending} type="submit">
          Save changes
        </button>
        {save.isError ? <p role="alert">{save.error.message}</p> : null}
        {save.isSuccess ? <p role="status">Policy saved.</p> : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Changes apply to future processing. Previously announced suspension dates and warning
          intervals are respected.
        </p>
      </form>
    </section>
  );
}

type Invoice = {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  totalCents: number;
  collectionStage?: string;
  suspensionScheduledAt?: string | null;
  outstandingCents?: number;
};
type History = {
  id: string;
  action: string;
  createdAt: string;
  actorUserId: string | null;
  notificationDeliveredAt?: string | null;
};
export function CollectionControls({
  subscriptionId,
  invoices,
  graceEndsAt,
  holdReason,
}: {
  subscriptionId: string;
  invoices: Invoice[];
  graceEndsAt: string | null;
  holdReason?: string | null;
}) {
  const { accessToken, user } = useAuth();
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState('');
  const [hold, setHold] = useState(holdReason ?? '');
  const history = useQuery({
    queryKey: ['collection-history', subscriptionId],
    queryFn: () =>
      apiRequest<History[]>(
        `/collections/subscriptions/${subscriptionId}/history`,
        {},
        accessToken,
      ),
    enabled: expanded && Boolean(accessToken),
  });
  const action = useMutation({
    mutationFn: ({ url, body, method = 'POST' }: { url: string; body: object; method?: string }) =>
      apiRequest(url, { method, body: JSON.stringify(body) }, accessToken),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['subscriptions'] }),
        client.invalidateQueries({ queryKey: ['collection-history', subscriptionId] }),
      ]);
    },
  });
  const admin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  return (
    <div className="mt-4 space-y-3 text-sm">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="rounded border border-border p-3">
          <p className="font-semibold">
            {invoice.invoiceNumber} ·{' '}
            {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
              (invoice.outstandingCents ?? invoice.totalCents) / 100,
            )}{' '}
            outstanding
          </p>
          <p>
            Due {new Date(invoice.dueDate).toLocaleDateString('en-AU')} ·{' '}
            {Math.max(
              0,
              Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86_400_000),
            )}{' '}
            days overdue
          </p>
          <p>Collection stage: {(invoice.collectionStage ?? 'NONE').replaceAll('_', ' ')}</p>
          {invoice.suspensionScheduledAt ? (
            <p>
              Suspension scheduled:{' '}
              {new Date(invoice.suspensionScheduledAt).toLocaleDateString('en-AU')}
            </p>
          ) : null}
          <button
            className="button-secondary mt-2"
            type="button"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                url: `/collections/invoices/${invoice.id}/remind`,
                body: { requestKey: crypto.randomUUID() },
              })
            }
          >
            Send payment reminder
          </button>
          <a
            className="ml-3 text-primary underline"
            href={`/admin/invoices?search=${encodeURIComponent(invoice.invoiceNumber)}`}
          >
            View invoice
          </a>
        </div>
      ))}
      {admin && graceEndsAt && invoices.length ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({
              url: `/subscriptions/${subscriptionId}/extend-grace-period`,
              body: { days, reason },
            });
          }}
        >
          <label>
            Extend grace by (days)
            <input
              aria-label="Extend grace by (days)"
              className="block w-28 rounded border border-border bg-background p-2"
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </label>
          <label>
            Reason
            <input
              aria-label="Grace extension reason"
              className="block rounded border border-border bg-background p-2"
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            className="button-secondary"
            disabled={action.isPending || reason.trim().length < 3}
            type="submit"
          >
            Extend grace period
          </button>
          <p className="w-full text-xs text-muted-foreground">
            Current: {new Date(graceEndsAt).toLocaleDateString('en-AU')} · New:{' '}
            {new Date(new Date(graceEndsAt).getTime() + days * 86_400_000).toLocaleDateString(
              'en-AU',
            )}
          </p>
        </form>
      ) : null}
      {admin ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({
              url: `/collections/subscriptions/${subscriptionId}/hold`,
              method: 'PUT',
              body: { reason: hold },
            });
          }}
        >
          <label>
            Collection hold reason (blank to release)
            <input
              aria-label="Collection hold reason"
              className="block rounded border border-border bg-background p-2"
              maxLength={1000}
              value={hold}
              onChange={(event) => setHold(event.target.value)}
            />
          </label>
          <button className="button-secondary" disabled={action.isPending} type="submit">
            Save hold
          </button>
        </form>
      ) : null}
      {action.isError ? <p role="alert">{action.error.message}</p> : null}
      {action.isSuccess ? <p role="status">Collection action recorded.</p> : null}
      <button
        className="font-semibold text-primary underline"
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        Collection history
      </button>
      {expanded ? (
        history.isError ? (
          <p role="alert">Could not load collection history.</p>
        ) : (
          <ul className="space-y-1">
            {history.data?.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.createdAt).toLocaleString('en-AU')} ·{' '}
                {entry.action.replaceAll('_', ' ')}
                {entry.action.endsWith('_SENT') && !entry.notificationDeliveredAt
                  ? ' (delivery queued)'
                  : ''}
                {entry.actorUserId ? ' · Staff action' : ' · Automated'}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
