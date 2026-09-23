'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { CancellationTimeline, type CancellationTimelineStatus } from './cancellation-timeline';

type CancellationType = 'END_OF_PERIOD' | 'IMMEDIATE';
type CancellationReason =
  | 'MOVING_HOME'
  | 'SWITCHING_PROVIDER'
  | 'PRICE'
  | 'SERVICE_QUALITY'
  | 'CONNECTION_PROBLEMS'
  | 'NO_LONGER_REQUIRED'
  | 'OTHER';

interface CustomerCancellationRecord {
  id: string;
  requestNumber: string;
  subscriptionId: string;
  type: CancellationType;
  reason: CancellationReason;
  reasonDetails: string | null;
  requestedAt: string;
  effectiveAt: string;
  status: CancellationTimelineStatus;
  completedAt: string | null;
  revokedAt: string | null;
  canRevoke: boolean;
  statusMessage: string;
}

interface CancellationPreview {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingAt: string;
  proposedServiceEndAt: string;
  outstandingBalanceCents: number;
  currency: string;
  automaticRefundCents: null;
  billingMessage: string;
}

const reasons: Array<[CancellationReason, string]> = [
  ['MOVING_HOME', 'Moving home'],
  ['SWITCHING_PROVIDER', 'Switching provider'],
  ['PRICE', 'Price'],
  ['SERVICE_QUALITY', 'Service quality'],
  ['CONNECTION_PROBLEMS', 'Connection problems'],
  ['NO_LONGER_REQUIRED', 'No longer required'],
  ['OTHER', 'Other'],
];

export function CustomerCancellation({
  subscription,
  accessToken,
}: Readonly<{
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    monthlyCents: number;
    plan: { name: string; monthlyCents: number };
  };
  accessToken: string | null;
}>) {
  const queryClient = useQueryClient();
  const canCancel = ['ACTIVE', 'PAST_DUE', 'SUSPENDED'].includes(subscription.status);
  const canSchedule = subscription.status === 'ACTIVE';
  const [step, setStep] = useState(0);
  const [type, setType] = useState<CancellationType>(canSchedule ? 'END_OF_PERIOD' : 'IMMEDIATE');
  const [reason, setReason] = useState<CancellationReason>('MOVING_HOME');
  const [reasonDetails, setReasonDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const cancellationType: CancellationType = canSchedule ? type : 'IMMEDIATE';

  const cancellation = useQuery({
    queryKey: ['subscription-cancellation', subscription.id],
    queryFn: () =>
      apiRequest<{ cancellation: CustomerCancellationRecord | null }>(
        `/subscriptions/${subscription.id}/cancellation`,
        {},
        accessToken,
      ).then((response) => response.cancellation),
    enabled: Boolean(accessToken),
  });
  const preview = useQuery({
    queryKey: ['subscription-cancellation-preview', subscription.id, cancellationType],
    queryFn: () =>
      apiRequest<CancellationPreview>(
        `/subscriptions/${subscription.id}/cancellation/preview?type=${cancellationType}`,
        {},
        accessToken,
      ),
    enabled: Boolean(accessToken && step === 3 && canCancel),
  });
  const requestCancellation = useMutation({
    mutationFn: () =>
      apiRequest<CustomerCancellationRecord>(
        `/subscriptions/${subscription.id}/cancellation`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: cancellationType,
            reason,
            reasonDetails: reasonDetails.trim() || undefined,
            confirmed,
          }),
        },
        accessToken,
      ),
    onSuccess: async () => {
      setStep(0);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription-cancellation', subscription.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] }),
      ]);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription-cancellation', subscription.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      apiRequest<CustomerCancellationRecord>(
        `/subscriptions/${subscription.id}/cancellation/revoke`,
        { method: 'POST' },
        accessToken,
      ),
    onSuccess: async () => {
      setConfirmRevoke(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription-cancellation', subscription.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] }),
      ]);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription-cancellation', subscription.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
    },
  });

  if (cancellation.isPending) {
    return <p className="mt-6 text-sm text-muted-foreground">Checking cancellation status…</p>;
  }
  if (cancellation.isError) {
    return (
      <section className="mt-8 rounded-2xl border border-destructive-border bg-destructive-subtle p-6" role="alert">
        <h2 className="text-lg font-bold text-foreground">Cancellation options unavailable</h2>
        <p className="mt-2 text-sm text-foreground">
          We couldn&apos;t verify whether this service already has a cancellation in progress.
        </p>
        <button
          className="button-secondary mt-4"
          onClick={() => cancellation.refetch()}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }
  if (cancellation.data?.status === 'COMPLETED') {
    return (
      <section
        className="mt-8 rounded-2xl border border-border bg-muted p-6"
        aria-labelledby="completed-cancellation-title"
      >
        <p className="text-sm font-semibold tracking-wide text-muted-foreground">SERVICE HISTORY</p>
        <h2 className="mt-2 text-2xl font-bold text-foreground" id="completed-cancellation-title">
          Service ended
        </h2>
        <p className="mt-2 max-w-2xl text-foreground">{cancellation.data.statusMessage}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{cancellation.data.requestNumber}</p>
        <CancellationTimeline
          status={cancellation.data.status}
          requestedAt={cancellation.data.requestedAt}
          effectiveAt={cancellation.data.effectiveAt}
          completedAt={cancellation.data.completedAt}
        />
      </section>
    );
  }
  const activeCancellation =
    cancellation.data && !['COMPLETED', 'REVOKED'].includes(cancellation.data.status)
      ? cancellation.data
      : null;
  if (activeCancellation) {
    return (
      <section
        className="mt-8 rounded-2xl border border-warning-border bg-warning-subtle p-6"
        aria-labelledby="cancellation-status-title"
      >
        <p className="text-sm font-semibold tracking-wide text-warning-foreground">MANAGE SERVICE</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground" id="cancellation-status-title">
              {activeCancellation.status === 'SCHEDULED'
                ? 'Cancellation scheduled'
                : activeCancellation.status === 'FAILED'
                  ? 'Cancellation needs review'
                  : 'Cancellation in progress'}
            </h2>
            <p className="mt-2 max-w-2xl text-foreground">{activeCancellation.statusMessage}</p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {activeCancellation.requestNumber}
            </p>
          </div>
          {activeCancellation.canRevoke ? (
            <button
              className="button-secondary"
              onClick={() => setConfirmRevoke(true)}
              type="button"
            >
              Keep My Service
            </button>
          ) : null}
        </div>
        <CancellationTimeline
          status={activeCancellation.status}
          requestedAt={activeCancellation.requestedAt}
          effectiveAt={activeCancellation.effectiveAt}
          completedAt={activeCancellation.completedAt}
        />
        {revoke.error ? (
          <ErrorMessage error={revoke.error} fallback="We couldn't revoke this cancellation." />
        ) : null}
        <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Keep your internet service?</AlertDialogTitle>
              <AlertDialogDescription>
                Your scheduled cancellation will be revoked and your existing plan and billing cycle
                will continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revoke.isPending}>Go back</AlertDialogCancel>
              <AlertDialogAction disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                {revoke.isPending ? 'Keeping service…' : 'Keep My Service'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    );
  }

  if (!canCancel) return null;

  return (
    <section
      className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm"
      aria-labelledby="cancel-service-title"
    >
      <p className="text-sm font-semibold tracking-wide text-primary">MANAGE SERVICE</p>
      <h2 className="mt-2 text-2xl font-bold text-foreground" id="cancel-service-title">
        {step ? 'Cancel your internet service' : 'Service options'}
      </h2>
      {step === 0 ? (
        <div>
          <p className="mt-2 text-muted-foreground">
            Need to leave? Review the effective date and billing implications before submitting a
            cancellation.
          </p>
          <button className="button-secondary mt-5" onClick={() => setStep(1)} type="button">
            Cancel Service
          </button>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="mt-5">
          <dl className="grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-2">
            <Fact label="Current plan" value={subscription.plan.name} />
            <Fact label="Monthly price" value={`${formatMoney(subscription.monthlyCents)}/month`} />
            <Fact
              label="Current billing period"
              value={`${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`}
            />
            <Fact label="Next billing date" value={formatDate(subscription.currentPeriodEnd)} />
          </dl>
          <div className="mt-5 flex gap-3">
            <button className="button-secondary" onClick={() => setStep(0)} type="button">
              Back
            </button>
            <button className="button-primary" onClick={() => setStep(2)} type="button">
              Continue
            </button>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="font-semibold text-foreground">
              When would you like your service to end?
            </legend>
            {canSchedule ? (
              <label className="mt-3 flex gap-3 rounded-xl border border-border p-4">
                <input
                  checked={type === 'END_OF_PERIOD'}
                  name="cancellation-type"
                  onChange={() => {
                    setType('END_OF_PERIOD');
                    setConfirmed(false);
                  }}
                  type="radio"
                />
                <span>
                  <strong>At the end of my current billing period</strong>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    Service continues until {formatDate(subscription.currentPeriodEnd)}.
                  </span>
                </span>
              </label>
            ) : (
              <p className="mt-3 rounded-xl bg-warning-subtle p-4 text-sm text-warning-foreground">
                Past-due or suspended services can only be cancelled as soon as possible.
                Outstanding invoices remain payable after cancellation.
              </p>
            )}
            <label className="mt-3 flex gap-3 rounded-xl border border-border p-4">
              <input
                checked={cancellationType === 'IMMEDIATE'}
                name="cancellation-type"
                onChange={() => {
                  setType('IMMEDIATE');
                  setConfirmed(false);
                }}
                type="radio"
              />
              <span>
                <strong>As soon as possible</strong>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Processing starts now. Refunds or credits are not automatic.
                </span>
              </span>
            </label>
          </fieldset>
          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor="cancellation-reason"
            >
              Why are you cancelling?
            </label>
            <select
              className="field mt-1"
              id="cancellation-reason"
              onChange={(event) => {
                setReason(event.target.value as CancellationReason);
                setConfirmed(false);
              }}
              value={reason}
            >
              {reasons.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {reason === 'OTHER' ? (
            <div>
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="cancellation-details"
              >
                Please tell us more
              </label>
              <textarea
                className="field mt-1 min-h-28"
                id="cancellation-details"
                maxLength={2000}
                onChange={(event) => {
                  setReasonDetails(event.target.value);
                  setConfirmed(false);
                }}
                required
                value={reasonDetails}
              />
            </div>
          ) : null}
          <div className="flex gap-3">
            <button className="button-secondary" onClick={() => setStep(1)} type="button">
              Back
            </button>
            <button
              className="button-primary"
              disabled={reason === 'OTHER' && reasonDetails.trim().length < 3}
              onClick={() => setStep(3)}
              type="button"
            >
              Review cancellation
            </button>
          </div>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="mt-5">
          {preview.isPending ? (
            <p className="text-muted-foreground">Preparing your cancellation summary…</p>
          ) : null}
          {preview.error ? (
            <ErrorMessage error={preview.error} fallback="We couldn't prepare this cancellation." />
          ) : null}
          {preview.data ? (
            <>
              <dl className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
                <Fact
                  label="Cancellation type"
                  value={
                    cancellationType === 'END_OF_PERIOD'
                      ? 'End of billing period'
                      : 'As soon as possible'
                  }
                />
                <Fact label="Service end" value={formatDate(preview.data.proposedServiceEndAt)} />
                <Fact
                  label="Outstanding balance"
                  value={formatMoney(preview.data.outstandingBalanceCents)}
                />
                <Fact label="Automatic refund" value="Not calculated or issued automatically" />
              </dl>
              <p className="mt-4 rounded-xl bg-primary-subtle p-4 text-sm text-primary-hover">
                {preview.data.billingMessage}
              </p>
              <label className="mt-5 flex gap-3 text-sm text-foreground">
                <input
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I understand my internet service will stop after this cancellation is completed.
                </span>
              </label>
              {requestCancellation.error ? (
                <ErrorMessage
                  error={requestCancellation.error}
                  fallback="We couldn't submit this cancellation."
                />
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  className="button-secondary"
                  disabled={requestCancellation.isPending}
                  onClick={() => setStep(2)}
                  type="button"
                >
                  Back
                </button>
                <button
                  className="button-primary"
                  disabled={!confirmed || requestCancellation.isPending}
                  onClick={() => requestCancellation.mutate()}
                  type="button"
                >
                  {requestCancellation.isPending ? 'Submitting…' : 'Confirm Cancellation'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ErrorMessage({ error, fallback }: Readonly<{ error: Error; fallback: string }>) {
  return (
    <p className="mt-4 rounded-xl bg-destructive-subtle p-4 text-sm text-destructive-foreground" role="alert">
      {error instanceof ApiError ? error.message : fallback}
    </p>
  );
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'long' }).format(new Date(value));
}
