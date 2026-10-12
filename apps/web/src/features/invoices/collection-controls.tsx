'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../../components/ui/alert-dialog';
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
  effectiveSuspensionDeadline?: string | null;
  recoveryFinalWarningSentAt?: string | null;
  recoverySuspensionDeadline?: string | null;
};
const collectionHistoryLabels: Record<string, string> = {
  ORIGINAL_GRACE_EXPIRED: 'Original payment grace period expired',
  FINAL_WARNING_MISSED: 'Final warning was missed',
  RECOVERY_SAFETY_EXTENSION: 'One-time 48-hour safety extension granted',
  RECOVERY_FINAL_WARNING_SENT: 'Recovery final payment notice sent',
  COLLECTION_HOLD_CREATED: 'Collection placed on hold',
  COLLECTION_HOLD_UPDATED: 'Collection hold updated',
  COLLECTION_HOLD_RELEASED: 'Collection hold released',
  COLLECTION_HOLD_EXPIRED: 'Collection hold expired',
  COLLECTION_DATA_REVIEW_REQUIRED: 'Collection records require billing review',
  FIRST_REMINDER_SENT: 'First payment reminder sent',
  SECOND_REMINDER_SENT: 'Urgent payment reminder sent',
  FINAL_WARNING_SENT: 'Final suspension warning sent',
  SUSPENSION_SCHEDULED: 'Automatic suspension scheduled',
  SERVICE_SUSPENDED_SENT: 'Service suspended notification sent',
  MANUAL_PAYMENT_REMINDER_SENT: 'Manual payment reminder sent',
  GRACE_PERIOD_EXTENDED: 'Payment grace period extended',
  GRACE_PERIOD_EXTENSION_NOTIFICATION: 'Payment deadline extension notification',
};
const collectionDate = (value: string, includeTime = false) =>
  new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long',
    timeStyle: includeTime ? 'short' : undefined,
    timeZone: 'Australia/Adelaide',
  }).format(new Date(value));
function currentSuspensionDate(invoice: Invoice, graceEndsAt: string | null) {
  if (invoice.effectiveSuspensionDeadline) return invoice.effectiveSuspensionDeadline;
  const dates = [invoice.suspensionScheduledAt, graceEndsAt].filter((value): value is string =>
    Boolean(value),
  );
  return dates.length
    ? new Date(Math.max(...dates.map((value) => new Date(value).getTime()))).toISOString()
    : null;
}
type History = {
  id: string;
  action: string;
  createdAt: string;
  actorUserId: string | null;
  notificationDeliveredAt?: string | null;
  metadata?: {
    notificationOutcome?: string;
    reason?: string;
    recoveryDeadline?: string;
    originalDeadline?: string;
    notes?: string | null;
    holdReason?: string | null;
    newDeadline?: string | null;
    previousDeadline?: string | null;
  };
};
export type CollectionHoldState = {
  status: 'NONE' | 'ACTIVE' | 'ON_HOLD' | 'RESOLVED';
  canPlace: boolean;
  canUpdate: boolean;
  canRelease: boolean;
  active: boolean;
  collectibleCents: number;
  message: string;
  reason?: string | null;
  notes?: string | null;
  until?: string | null;
};
const localHoldDate = (value?: string | null) =>
  value
    ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : '';
export function CollectionControls({
  subscriptionId,
  invoices,
  graceEndsAt,
  holdReason,
  collectionHold,
}: {
  subscriptionId: string;
  invoices: Invoice[];
  graceEndsAt: string | null;
  holdReason?: string | null;
  collectionHold?: CollectionHoldState;
}) {
  const { accessToken, user } = useAuth();
  const client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState('');
  const [hold, setHold] = useState(collectionHold?.reason ?? holdReason ?? '');
  const [holdNotes, setHoldNotes] = useState(collectionHold?.notes ?? '');
  const [holdUntil, setHoldUntil] = useState(localHoldDate(collectionHold?.until));
  const [releaseOpen, setReleaseOpen] = useState(false);
  useEffect(() => {
    setHold(collectionHold?.reason ?? holdReason ?? '');
    setHoldNotes(collectionHold?.notes ?? '');
    setHoldUntil(localHoldDate(collectionHold?.until));
  }, [collectionHold?.reason, collectionHold?.notes, collectionHold?.until, holdReason]);
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
        client.invalidateQueries({ queryKey: ['customer-collections'] }),
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
          <p>
            Collection stage:{' '}
            {invoice.recoveryFinalWarningSentAt
              ? 'RECOVERY FINAL WARNING'
              : (invoice.collectionStage ?? 'NONE').replaceAll('_', ' ')}
          </p>
          {invoice.recoverySuspensionDeadline ? (
            <p>
              Your original grace period expired. A one-time final payment opportunity has been
              granted.
            </p>
          ) : null}
          {invoice.suspensionScheduledAt ? (
            <p>
              Suspension scheduled:{' '}
              {collectionDate(
                currentSuspensionDate(invoice, graceEndsAt)!,
                Boolean(invoice.recoverySuspensionDeadline),
              )}
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
            Current: {collectionDate(graceEndsAt)} · New:{' '}
            {collectionDate(
              new Date(
                Math.max(Date.now(), new Date(graceEndsAt).getTime()) + days * 86_400_000,
              ).toISOString(),
            )}
          </p>
        </form>
      ) : null}
      <section aria-label="Collection hold" className="rounded border border-border p-3">
        <h3 className="font-semibold">Collection hold</h3>
        <p>
          {collectionHold?.active
            ? 'On hold'
            : collectionHold?.status === 'RESOLVED'
              ? 'Collection resolved'
              : collectionHold?.canPlace
                ? 'Available'
                : 'Unavailable'}
        </p>
        <p className="text-muted-foreground">
          {collectionHold?.message ??
            'Collection hold is only available when the account has an unresolved overdue balance.'}
        </p>
        {collectionHold?.active ? (
          <>
            <p>Reason: {collectionHold.reason}</p>
            <p>
              Until:{' '}
              {collectionHold.until ? collectionDate(collectionHold.until, true) : 'Until released'}
            </p>
            {collectionHold.notes ? <p>Notes: {collectionHold.notes}</p> : null}
          </>
        ) : null}
        {admin && (collectionHold?.canPlace || collectionHold?.canUpdate) ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate({
                url: `/collections/subscriptions/${subscriptionId}/hold`,
                method: 'PUT',
                body: {
                  reason: hold.trim(),
                  notes: holdNotes.trim() || null,
                  holdUntil: holdUntil ? new Date(holdUntil).toISOString() : null,
                },
              });
            }}
          >
            <label>
              Reason
              <input
                aria-label="Collection hold reason"
                className="block rounded border border-border bg-background p-2"
                required
                minLength={3}
                maxLength={1000}
                value={hold}
                onChange={(event) => setHold(event.target.value)}
              />
            </label>
            <label>
              Notes
              <textarea
                aria-label="Collection hold notes"
                className="block rounded border border-border bg-background p-2"
                maxLength={2000}
                value={holdNotes}
                onChange={(event) => setHoldNotes(event.target.value)}
              />
            </label>
            <label>
              Hold until (optional)
              <input
                aria-label="Hold until"
                type="datetime-local"
                className="block rounded border border-border bg-background p-2"
                value={holdUntil}
                onChange={(event) => setHoldUntil(event.target.value)}
              />
            </label>
            <button
              className="button-secondary"
              disabled={
                action.isPending ||
                hold.trim().length < 3 ||
                Boolean(holdUntil && new Date(holdUntil) <= new Date())
              }
              type="submit"
            >
              Save hold
            </button>
            <p className="w-full text-xs text-muted-foreground">
              Pauses automated reminders and billing suspension. Service status and the outstanding
              balance remain unchanged.
            </p>
          </form>
        ) : null}
        {admin && collectionHold?.canRelease ? (
          <>
            <button
              type="button"
              className="button-secondary mt-3"
              disabled={action.isPending}
              onClick={() => setReleaseOpen(true)}
            >
              Release hold
            </button>
            <AlertDialog open={releaseOpen} onOpenChange={setReleaseOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Release collection hold?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The collection service will recheck the balance and safely resume overdue
                    processing. Releasing this hold does not restore a suspended service.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep hold</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      action.mutate({
                        url: `/collections/subscriptions/${subscriptionId}/hold/release`,
                        body: { confirmed: true },
                      })
                    }
                  >
                    Confirm release
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </section>
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
                {entry.notificationDeliveredAt ? '✓ ' : '○ '}
                {collectionDate(entry.notificationDeliveredAt ?? entry.createdAt)} ·{' '}
                {entry.metadata?.notificationOutcome === 'SKIPPED'
                  ? `${entry.action.replaceAll('_SENT', '').replaceAll('_', ' ')} skipped (${entry.metadata.reason?.replaceAll('_', ' ') ?? 'no longer applicable'})`
                  : (collectionHistoryLabels[entry.action] ?? entry.action.replaceAll('_', ' '))}
                {entry.metadata?.recoveryDeadline
                  ? ` · Final deadline: ${collectionDate(entry.metadata.recoveryDeadline, true)}`
                  : ''}
                {entry.action.endsWith('_SENT') && !entry.notificationDeliveredAt
                  ? ' (delivery queued)'
                  : ''}
                {entry.action.startsWith('COLLECTION_HOLD_') ? (
                  <span className="block pl-4">
                    {entry.metadata?.holdReason ?? entry.metadata?.reason}
                    {entry.metadata?.notes ? ` · Notes: ${entry.metadata.notes}` : ''}
                    {entry.metadata?.newDeadline
                      ? ` · Until: ${collectionDate(entry.metadata.newDeadline, true)}`
                      : ''}
                  </span>
                ) : null}
                {entry.actorUserId ? ' · Staff action' : ' · Automated'}
              </li>
            ))}
            {invoices
              .filter((invoice) =>
                ['FINAL_WARNING', 'SUSPENSION_SCHEDULED'].includes(invoice.collectionStage ?? ''),
              )
              .map((invoice) => {
                const date = currentSuspensionDate(invoice, graceEndsAt);
                return date ? (
                  <li
                    key={`schedule-${invoice.id}`}
                    className="font-semibold text-warning-foreground"
                  >
                    ○ {collectionDate(date)} · Automatic suspension scheduled ·{' '}
                    {invoice.invoiceNumber}
                    {collectionHold?.active ? ' (paused by collection hold)' : ''}
                  </li>
                ) : null;
              })}
          </ul>
        )
      ) : null}
    </div>
  );
}
