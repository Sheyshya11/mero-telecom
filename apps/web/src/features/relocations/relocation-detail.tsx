'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

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
import { formatAddress, formatDate, friendly, StatusBadge } from './relocation-management';
import type { ServiceRelocation } from './relocation.types';

type ConfirmedAction = 'cancel' | 'escalate' | 'resolve-escalation' | 'override';

export function RelocationDetail({
  relocationId,
  basePath,
}: Readonly<{ relocationId: string; basePath: string }>) {
  const { accessToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const [disconnectDate, setDisconnectDate] = useState('');
  const [demoOperation, setDemoOperation] = useState<'PROVISIONING' | 'DISCONNECTION'>(
    'PROVISIONING',
  );
  const [demoOutcome, setDemoOutcome] = useState<'SUCCESS' | 'PENDING' | 'FAILED'>('FAILED');
  const [overrideAction, setOverrideAction] = useState('MARK_NEW_SERVICE_ACTIVE');
  const [targetStatus, setTargetStatus] = useState('FAILED');
  const [confirmedAction, setConfirmedAction] = useState<ConfirmedAction | null>(null);

  const relocation = useQuery({
    queryKey: ['relocation-detail', relocationId],
    queryFn: () => apiRequest<ServiceRelocation>(`/relocations/${relocationId}`, {}, accessToken),
    enabled: Boolean(accessToken && user),
  });

  const action = useMutation({
    mutationFn: ({
      endpoint,
      method = 'POST',
      body,
    }: {
      endpoint: string;
      method?: 'POST' | 'PATCH';
      body?: object;
    }) =>
      apiRequest<ServiceRelocation>(
        `/relocations/${relocationId}/${endpoint}`,
        { method, body: body ? JSON.stringify(body) : undefined },
        accessToken,
      ),
    onSuccess: async () => {
      setError(null);
      setNotice('Relocation updated successfully.');
      setConfirmedAction(null);
      setReason('');
      setNote('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['relocation-detail', relocationId] }),
        queryClient.invalidateQueries({ queryKey: ['relocations'] }),
      ]);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof ApiError ? cause.message : 'The relocation action failed.');
    },
  });

  if (relocation.isPending) return <Status message="Loading relocation…" />;
  if (relocation.isError || !relocation.data)
    return <Status message="Unable to load this relocation." />;
  const data = relocation.data;
  const capabilities = data.capabilities;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const effectiveDemoOperation =
    !capabilities?.canSimulateProvisioning && capabilities?.canSimulateDisconnection
      ? 'DISCONNECTION'
      : demoOperation;
  const newServiceStatus = data.newServiceActivatedAt
    ? 'ACTIVE'
    : (data.provisioningStatus ?? 'NOT_STARTED');

  function submitConfirmed() {
    if (!confirmedAction || reason.trim().length < 10) return;
    if (confirmedAction === 'cancel')
      action.mutate({ endpoint: 'cancel', body: { reason: reason.trim() } });
    if (confirmedAction === 'escalate')
      action.mutate({ endpoint: 'escalate', body: { reason: reason.trim(), priority: 'HIGH' } });
    if (confirmedAction === 'resolve-escalation')
      action.mutate({ endpoint: 'resolve-escalation', body: { reason: reason.trim() } });
    if (confirmedAction === 'override')
      action.mutate({
        endpoint: 'override',
        body: {
          action: overrideAction,
          reason: reason.trim(),
          ...(overrideAction === 'SET_STATUS' ? { targetStatus } : {}),
        },
      });
  }

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-primary">
            RELOCATION {data.id.slice(0, 8).toUpperCase()}
          </p>
          <h1 className="mt-2 text-3xl font-bold">Relocation details</h1>
          <p className="mt-2 text-muted-foreground">
            {data.customer.firstName} {data.customer.lastName} · {data.customer.email}
          </p>
        </div>
        <Link className="button-secondary" href={basePath}>
          Back to relocations
        </Link>
      </header>
      {notice ? (
        <p className="mt-6 rounded-lg bg-success-subtle p-4 text-success-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-6 rounded-lg bg-destructive-subtle p-4 text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Overall status" value={<StatusBadge value={data.status} />} />
        <Summary label="Requested move" value={formatDate(data.requestedMoveDate)} />
        <Summary label="Selected plan" value={data.requestedPlan.name} />
        <Summary label="Provider mode" value={friendly(data.providerMode ?? 'LIVE')} />
      </section>

      {data.escalation ? (
        <section className="mt-6 rounded-xl border border-warning bg-warning-subtle p-5 text-warning-foreground">
          <h2 className="font-semibold">Super Admin review · {data.escalation.requestNumber}</h2>
          <p className="mt-1 text-sm">
            {data.escalation.events[0]?.comment ?? 'This relocation requires manual review.'}
          </p>
          {isSuperAdmin ? (
            <button
              className="button-secondary mt-4"
              onClick={() => setConfirmedAction('resolve-escalation')}
              type="button"
            >
              Resolve escalation
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <OperationalSection
          title="NEW SERVICE"
          subtitle="Qualification, provisioning and activation"
        >
          <Detail label="New address" value={formatAddress(data.newServiceAddress)} />
          <Detail label="Qualification" value={<StatusBadge value={data.qualificationStatus} />} />
          <Detail label="Technology" value={data.newServiceAddress.technology ?? 'Not supplied'} />
          <Detail
            label="Service class"
            value={data.newServiceAddress.serviceClass ?? 'Not supplied'}
          />
          <Detail label="Provisioning" value={<StatusBadge value={newServiceStatus} />} />
          <Detail
            label="Attempts"
            value={`${data.attemptCount} / ${capabilities?.maxProvisioningAttempts ?? 3} normal attempts`}
          />
          <Detail label="Provider reference" value={data.providerReference ?? 'Not submitted'} />
          <Detail
            label="Activated"
            value={
              data.newServiceActivatedAt ? formatDateTime(data.newServiceActivatedAt) : 'Not active'
            }
          />
          {data.failureReason ? <Failure>{data.failureReason}</Failure> : null}
        </OperationalSection>
        <OperationalSection title="OLD SERVICE" subtitle="Current connection and disconnection">
          <Detail label="Current address" value={formatAddress(data.oldServiceAddress)} />
          <Detail
            label="Disconnection"
            value={<StatusBadge value={data.oldServiceDisconnectionStatus ?? 'NOT_STARTED'} />}
          />
          <Detail
            label="Requested date"
            value={
              data.requestedOldServiceDisconnectionDate
                ? formatDate(data.requestedOldServiceDisconnectionDate)
                : 'After new service activation'
            }
          />
          <Detail
            label="Attempts"
            value={`${data.disconnectionAttemptCount} / ${capabilities?.maxDisconnectionAttempts ?? 3} normal attempts`}
          />
          <Detail
            label="Provider reference"
            value={data.disconnectionProviderReference ?? 'Not submitted'}
          />
          <Detail
            label="Disconnected"
            value={
              data.oldServiceDisconnectedAt
                ? formatDateTime(data.oldServiceDisconnectedAt)
                : 'Still connected or pending'
            }
          />
          {data.disconnectionFailureReason ? (
            <Failure>{data.disconnectionFailureReason}</Failure>
          ) : null}
        </OperationalSection>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <OperationalSection title="CUSTOMER & BILLING" subtitle="Read-only operational context">
          <Detail label="Customer" value={`${data.customer.firstName} ${data.customer.lastName}`} />
          <Detail label="Email" value={data.customer.email} />
          <Detail
            label="Subscription"
            value={`${data.subscriptionId} · ${data.subscription?.status ?? 'Unknown'}`}
          />
          <Detail label="Current plan" value={data.currentPlan.name} />
          <Detail label="Requested plan" value={data.requestedPlan.name} />
          <Detail
            label="Latest invoice"
            value={
              data.billing
                ? `${data.billing.invoiceNumber} · ${friendly(data.billing.status)}`
                : 'No invoice available'
            }
          />
          <Detail
            label="Latest payment"
            value={
              data.billing?.payments[0]
                ? friendly(data.billing.payments[0].status)
                : 'No payment available'
            }
          />
        </OperationalSection>
        <OperationalSection title="INTERNAL NOTES" subtitle="Never visible to customers">
          <div className="space-y-3">
            {data.notes?.map((item) => (
              <article className="rounded-lg border border-border p-3 text-sm" key={item.id}>
                <p>{item.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.author.displayName ?? item.author.email} · {friendly(item.authorRole)} ·{' '}
                  {formatDateTime(item.createdAt)}
                </p>
              </article>
            ))}
            {!data.notes?.length ? (
              <p className="text-sm text-muted-foreground">No internal notes yet.</p>
            ) : null}
          </div>
          {capabilities?.canAddNote ? (
            <div className="mt-4 grid gap-2">
              <textarea
                className="field min-h-24"
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add an internal operational note"
                value={note}
              />
              <button
                className="button-secondary"
                disabled={action.isPending || !note.trim()}
                onClick={() => action.mutate({ endpoint: 'notes', body: { body: note.trim() } })}
                type="button"
              >
                Add note
              </button>
            </div>
          ) : null}
        </OperationalSection>
      </div>

      {capabilities?.canConfirm ||
      capabilities?.canRetryQualification ||
      capabilities?.canRetryProvisioning ||
      capabilities?.canRetryDisconnection ||
      capabilities?.canReschedule ||
      capabilities?.canEscalate ||
      capabilities?.canCancel ? (
        <OperationalSection
          title="ADMIN OPERATIONS"
          subtitle="Normal relocation workflow controls"
          className="mt-6"
        >
          <div className="flex flex-wrap gap-2">
            {capabilities.canConfirm ? (
              <button
                className="button-primary"
                disabled={action.isPending}
                onClick={() => action.mutate({ endpoint: 'confirm' })}
                type="button"
              >
                Confirm relocation
              </button>
            ) : null}
            {capabilities.canRetryQualification ? (
              <button
                className="button-secondary"
                disabled={action.isPending}
                onClick={() => action.mutate({ endpoint: 'retry-qualification' })}
                type="button"
              >
                Retry qualification
              </button>
            ) : null}
            {capabilities.canRetryProvisioning ? (
              <button
                className="button-secondary"
                disabled={action.isPending}
                onClick={() => action.mutate({ endpoint: 'retry-provisioning' })}
                type="button"
              >
                Retry provisioning
              </button>
            ) : null}
            {capabilities.canRetryDisconnection ? (
              <button
                className="button-secondary"
                disabled={action.isPending}
                onClick={() => action.mutate({ endpoint: 'retry-disconnection' })}
                type="button"
              >
                Retry disconnection
              </button>
            ) : null}
            {capabilities.canEscalate ? (
              <button
                className="button-secondary"
                onClick={() => setConfirmedAction('escalate')}
                type="button"
              >
                Escalate
              </button>
            ) : null}
            {capabilities.canCancel ? (
              <button
                className="button-danger"
                onClick={() => setConfirmedAction('cancel')}
                type="button"
              >
                Cancel relocation
              </button>
            ) : null}
          </div>
          {capabilities.canReschedule ? (
            <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-[1fr_1fr_auto]">
              <label className="grid gap-1 text-sm font-medium">
                Move date
                <input
                  className="field"
                  onChange={(event) => setMoveDate(event.target.value)}
                  type="date"
                  value={moveDate}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Old-service disconnection
                <input
                  className="field"
                  onChange={(event) => setDisconnectDate(event.target.value)}
                  type="date"
                  value={disconnectDate}
                />
              </label>
              <button
                className="button-secondary self-end"
                disabled={!moveDate || action.isPending}
                onClick={() =>
                  action.mutate({
                    endpoint: 'schedule',
                    method: 'PATCH',
                    body: {
                      requestedMoveDate: moveDate,
                      ...(disconnectDate
                        ? { requestedOldServiceDisconnectionDate: disconnectDate }
                        : {}),
                    },
                  })
                }
                type="button"
              >
                Change date
              </button>
            </div>
          ) : null}
        </OperationalSection>
      ) : null}

      {capabilities?.canConfigureDemo ? (
        <OperationalSection
          title="SIMULATED PROVIDER"
          subtitle="Deterministic controls for demonstrations and tests"
          className="mt-6"
        >
          <p className="mb-4 text-sm text-muted-foreground">
            Select the result the mock provider should return. This immediately runs an eligible
            operation, including retrying a failed operation. Controls appear only when an operation
            can currently be processed.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="grid gap-1 text-sm font-medium">
              Operation
              <select
                className="field"
                onChange={(event) => setDemoOperation(event.target.value as typeof demoOperation)}
                value={effectiveDemoOperation}
              >
                <option disabled={!capabilities.canSimulateProvisioning} value="PROVISIONING">
                  New service provisioning
                </option>
                <option disabled={!capabilities.canSimulateDisconnection} value="DISCONNECTION">
                  Old service disconnection
                </option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Next result
              <select
                className="field"
                onChange={(event) => setDemoOutcome(event.target.value as typeof demoOutcome)}
                value={demoOutcome}
              >
                <option value="FAILED">Failed</option>
                <option value="PENDING">Pending then success</option>
                <option value="SUCCESS">Success now</option>
              </select>
            </label>
            <button
              className="button-secondary self-end"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  endpoint: 'demo-outcome',
                  body: {
                    operation: effectiveDemoOperation,
                    outcome: demoOutcome,
                    processNow: true,
                  },
                })
              }
              type="button"
            >
              Set and process
            </button>
          </div>
        </OperationalSection>
      ) : null}

      {capabilities?.canOverride ? (
        <OperationalSection
          title="SUPER ADMIN OVERRIDE"
          subtitle="Exceptional actions require a recorded reason"
          className="mt-6"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="grid gap-1 text-sm font-medium">
              Override action
              <select
                className="field"
                onChange={(event) => setOverrideAction(event.target.value)}
                value={overrideAction}
              >
                <option value="MARK_NEW_SERVICE_ACTIVE">Mark new service active</option>
                <option value="MARK_OLD_SERVICE_DISCONNECTED">Mark old service disconnected</option>
                <option value="FORCE_RETRY_PROVISIONING">Force provisioning retry</option>
                <option value="FORCE_RETRY_DISCONNECTION">Force disconnection retry</option>
                <option value="REOPEN">Reopen workflow</option>
                <option value="SET_STATUS">Set safe workflow status</option>
                <option value="FORCE_CLOSE">Force close</option>
              </select>
            </label>
            {overrideAction === 'SET_STATUS' ? (
              <label className="grid gap-1 text-sm font-medium">
                Target status
                <select
                  className="field"
                  onChange={(event) => setTargetStatus(event.target.value)}
                  value={targetStatus}
                >
                  <option value="AWAITING_CONFIRMATION">Awaiting confirmation</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="FAILED">Failed</option>
                  <option value="MANUAL_REVIEW_REQUIRED">Manual review</option>
                </select>
              </label>
            ) : (
              <div />
            )}
            <button
              className="button-danger self-end"
              onClick={() => setConfirmedAction('override')}
              type="button"
            >
              Review override
            </button>
          </div>
        </OperationalSection>
      ) : null}

      <OperationalSection
        title="AUDIT TIMELINE"
        subtitle="Chronological relocation events"
        className="mt-6"
      >
        <ol className="space-y-4 border-l border-border pl-5">
          {data.auditHistory?.map((event) => (
            <li className="relative" key={event.id}>
              <span className="absolute -left-[1.55rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="font-semibold">{friendly(event.action)}</p>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(event.createdAt)} ·{' '}
                {event.actor?.displayName ?? event.actor?.email ?? 'System'}
              </p>
              {event.metadata ? (
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {auditDetails(event.metadata)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </OperationalSection>

      <AlertDialog
        open={Boolean(confirmedAction)}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmedAction(null);
            setReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmedAction === 'override'
                ? 'Confirm privileged override'
                : confirmedAction === 'cancel'
                  ? 'Cancel this relocation?'
                  : confirmedAction === 'escalate'
                    ? 'Escalate to Super Admin?'
                    : 'Resolve this escalation?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action is audited. Enter a meaningful reason of at least 10 characters.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            className="field min-h-24"
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason"
            value={reason}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={action.isPending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={action.isPending || reason.trim().length < 10}
              onClick={submitConfirmed}
            >
              {action.isPending ? 'Applying…' : 'Confirm action'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function OperationalSection({
  children,
  className = '',
  subtitle,
  title,
}: Readonly<{ children: React.ReactNode; className?: string; subtitle: string; title: string }>) {
  return (
    <section className={`rounded-xl border border-border bg-card p-6 shadow-sm ${className}`}>
      <p className="text-xs font-bold tracking-widest text-primary">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-5 space-y-3">{children}</div>
    </section>
  );
}
function Summary({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-2 font-bold">{value}</div>
    </article>
  );
}
function Detail({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="grid gap-1 border-b border-border pb-3 text-sm last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Failure({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="rounded-lg bg-destructive-subtle p-3 text-sm text-destructive-foreground">
      {children}
    </p>
  );
}
function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="workspace-page mx-auto min-h-screen max-w-6xl px-6 py-10">
      <p className="text-muted-foreground">{message}</p>
    </main>
  );
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Australia/Adelaide',
  }).format(new Date(value));
}
function auditDetails(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(
      ([key, value]) =>
        `${friendly(key)}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ');
}
