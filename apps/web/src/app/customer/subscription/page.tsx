'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../../features/auth/auth-provider';
import { PlanCheckoutButton } from '../../../features/payments/stripe-checkout-button';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Plan = {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
};

type Subscription = {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: Plan;
};

type PlanChangeStatus =
  | 'PENDING'
  | 'CHECKOUT_CREATED'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'APPLIED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

type PlanChangePreview = {
  type: 'UPGRADE' | 'DOWNGRADE';
  currentPlan: Plan;
  targetPlan: Plan;
  currentPlanPriceCents: number;
  targetPlanPriceCents: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  effectiveAt: string;
  remainingDurationMilliseconds: number;
  unusedCreditCents: number;
  proratedTargetCents: number;
  amountPayableCents: number;
  currency: string;
  calculatedAt: string;
};

type PlanChange = Omit<PlanChangePreview, 'remainingDurationMilliseconds' | 'calculatedAt'> & {
  id: string;
  sourceSubscriptionId: string;
  newSubscriptionId: string | null;
  status: PlanChangeStatus;
  requestedAt: string;
  appliedAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
};

type PlanChangeRequestResult = { planChange: PlanChange; checkoutUrl: string | null };

type CheckoutStatus = {
  checkoutStatus: string | null;
  stripePaymentStatus: string;
  paymentStatus: string;
  invoiceStatus: string;
  subscription: { id: string; status: string; plan: { name: string } } | null;
};

const activeChangeStatuses: PlanChangeStatus[] = [
  'PENDING',
  'CHECKOUT_CREATED',
  'PROCESSING',
  'SCHEDULED',
];

export default function CustomerSubscriptionPage() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [targetPlanId, setTargetPlanId] = useState('');
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(null);
  const [checkoutReturn, setCheckoutReturn] = useState<'success' | 'cancelled' | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<'success' | 'cancelled' | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [planChangeRequestId, setPlanChangeRequestId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planChange = params.get('planChange');
    const payment = params.get('payment');
    setRequestedPlanId(params.get('planId'));
    setCheckoutReturn(planChange === 'success' || planChange === 'cancelled' ? planChange : null);
    setPaymentReturn(payment === 'success' || payment === 'cancelled' ? payment : null);
    setCheckoutSessionId(params.get('sessionId'));
    setPlanChangeRequestId(params.get('requestId'));
  }, []);

  const subscriptions = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: () => apiRequest<Subscription[]>('/subscriptions/me', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<Plan[]>('/plans/public', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const currentSubscription = useMemo(
    () =>
      subscriptions.data?.find((subscription) =>
        ['ACTIVE', 'SUSPENDED'].includes(subscription.status),
      ),
    [subscriptions.data],
  );
  const latestChange = useQuery({
    queryKey: ['plan-change'],
    queryFn: () =>
      apiRequest<{ data: PlanChange[] }>('/plan-change-requests?limit=1', {}, accessToken),
    select: (result) => result.data[0] ?? null,
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const checkoutReconciliation = useQuery({
    queryKey: ['checkout-reconciliation', checkoutSessionId],
    queryFn: () =>
      apiRequest<CheckoutStatus>(
        `/payments/checkout-status?sessionId=${encodeURIComponent(checkoutSessionId!)}`,
        {},
        accessToken,
      ),
    enabled: Boolean(
      accessToken && user?.role === 'CUSTOMER' && paymentReturn === 'success' && checkoutSessionId,
    ),
    retry: 1,
  });
  const planChangeReconciliation = useQuery({
    queryKey: ['plan-change-reconciliation', planChangeRequestId],
    queryFn: () =>
      apiRequest<PlanChange>(
        `/plan-change-requests/${planChangeRequestId}/reconcile`,
        { method: 'POST' },
        accessToken,
      ),
    enabled: Boolean(
      accessToken &&
      user?.role === 'CUSTOMER' &&
      checkoutReturn === 'success' &&
      planChangeRequestId,
    ),
    retry: 1,
  });
  const availableTargets = useMemo(
    () => plans.data?.filter((plan) => plan.id !== currentSubscription?.plan.id) ?? [],
    [currentSubscription?.plan.id, plans.data],
  );
  const displayedPlans = useMemo(() => {
    const availablePlans = plans.data ?? [];
    if (!requestedPlanId) return availablePlans;
    return [...availablePlans].sort(
      (left, right) => Number(right.id === requestedPlanId) - Number(left.id === requestedPlanId),
    );
  }, [plans.data, requestedPlanId]);

  useEffect(() => {
    if (
      requestedPlanId &&
      currentSubscription?.status === 'ACTIVE' &&
      availableTargets.some((plan) => plan.id === requestedPlanId)
    ) {
      setTargetPlanId(requestedPlanId);
    }
  }, [availableTargets, currentSubscription?.status, requestedPlanId]);

  useEffect(() => {
    if (targetPlanId && !availableTargets.some((plan) => plan.id === targetPlanId)) {
      setTargetPlanId('');
    }
  }, [availableTargets, targetPlanId]);

  useEffect(() => {
    if (!checkoutReconciliation.data && !planChangeReconciliation.data) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      queryClient.invalidateQueries({ queryKey: ['plan-change'] }),
    ]);
  }, [checkoutReconciliation.data, planChangeReconciliation.data, queryClient]);

  const preview = useMutation({
    mutationFn: () =>
      apiRequest<PlanChangePreview>(
        `/subscriptions/${currentSubscription!.id}/plan-change/preview`,
        { method: 'POST', body: JSON.stringify({ targetPlanId }) },
        accessToken,
      ),
  });
  const requestChange = useMutation({
    mutationFn: () =>
      apiRequest<PlanChangeRequestResult>(
        `/subscriptions/${currentSubscription!.id}/plan-change`,
        { method: 'POST', body: JSON.stringify({ targetPlanId }) },
        accessToken,
      ),
    onSuccess: async ({ checkoutUrl }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan-change'] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
      if (checkoutUrl) window.location.assign(checkoutUrl);
    },
  });
  const cancelChange = useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<PlanChange>(
        `/plan-change-requests/${requestId}/cancel`,
        { method: 'POST' },
        accessToken,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan-change'] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
      preview.reset();
    },
  });

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Checking your session…
      </main>
    );
  }
  if (!user || user.role !== 'CUSTOMER') {
    return (
      <main className="grid min-h-screen place-items-center text-slate-600">
        Customer access is required.
      </main>
    );
  }

  const pendingChange =
    latestChange.data && activeChangeStatuses.includes(latestChange.data.status)
      ? latestChange.data
      : null;
  const mutationError = preview.error ?? requestChange.error ?? cancelChange.error;

  return (
    <main className="workspace-page mx-auto min-h-screen max-w-4xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
          <h1 className="mt-2 text-3xl font-bold">My subscription</h1>
        </div>
      </header>

      {subscriptions.isPending ? (
        <p className="mt-6 text-slate-600">Loading your subscription…</p>
      ) : null}
      {subscriptions.isError ? (
        <ErrorPanel
          message="Unable to load your subscription."
          retry={() => subscriptions.refetch()}
        />
      ) : null}

      <div className="mt-6 space-y-4">
        {subscriptions.data?.map((subscription) => (
          <article
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            key={subscription.id}
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-950">{subscription.plan.name}</h2>
                <p className="mt-2 text-slate-600">
                  {subscription.plan.downloadMbps}/{subscription.plan.uploadMbps} Mbps ·{' '}
                  {formatMoney(subscription.plan.monthlyCents)}/month
                </p>
              </div>
              <span className="h-fit rounded-full bg-slate-100 px-2 py-1 text-xs">
                {subscription.status}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Started {formatDate(subscription.startDate)}
              {subscription.status === 'ACTIVE'
                ? ` · Current billing period ends ${formatDate(subscription.currentPeriodEnd)}`
                : ''}
            </p>
          </article>
        ))}
      </div>

      {latestChange.isError ? (
        <ErrorPanel
          message="Unable to load the latest plan change."
          retry={() => latestChange.refetch()}
        />
      ) : null}
      {paymentReturn ? (
        <PaymentReturnNotice
          error={checkoutReconciliation.isError}
          state={paymentReturn}
          status={checkoutReconciliation.data}
          verifying={checkoutReconciliation.isPending && Boolean(checkoutSessionId)}
        />
      ) : null}
      {checkoutReturn ? (
        <CheckoutReturnNotice
          error={planChangeReconciliation.isError}
          state={checkoutReturn}
          status={planChangeReconciliation.data?.status}
          verifying={planChangeReconciliation.isPending && Boolean(planChangeRequestId)}
        />
      ) : null}
      {pendingChange ? (
        <PendingPlanChange
          change={pendingChange}
          cancelling={cancelChange.isPending}
          onCancel={() => cancelChange.mutate(pendingChange.id)}
          onContinue={() => {
            setTargetPlanId(pendingChange.targetPlan.id);
            requestChange.mutate();
          }}
        />
      ) : null}
      {latestChange.data && !pendingChange ? (
        <CompletedPlanChange change={latestChange.data} />
      ) : null}

      {currentSubscription?.status === 'SUSPENDED' ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          Plan changes are unavailable while this subscription is suspended. Contact support to
          resolve the suspension first.
        </p>
      ) : null}

      {currentSubscription?.status === 'ACTIVE' && !pendingChange ? (
        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold tracking-wide text-sky-700">CHANGE PLAN</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">Upgrade or downgrade</h2>
          <p className="mt-2 text-slate-600">
            Choose an available plan. Pricing and any prorated charge are calculated securely by the
            server.
          </p>

          {requestedPlanId === currentSubscription.plan.id ? (
            <p className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              {currentSubscription.plan.name} is already your current plan. Choose another plan to
              upgrade or downgrade.
            </p>
          ) : null}

          {plans.isPending ? <p className="mt-5 text-slate-600">Loading available plans…</p> : null}
          {plans.isError ? (
            <ErrorPanel message="Unable to load available plans." retry={() => plans.refetch()} />
          ) : null}
          {availableTargets.length ? (
            <div className="mt-5">
              <label className="block text-sm font-medium text-slate-700" htmlFor="target-plan">
                New plan
              </label>
              <select
                className="field mt-1"
                id="target-plan"
                onChange={(event) => {
                  setTargetPlanId(event.target.value);
                  preview.reset();
                  requestChange.reset();
                }}
                value={targetPlanId}
              >
                <option value="">Select a plan</option>
                {availableTargets.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {plan.downloadMbps}/{plan.uploadMbps} Mbps —{' '}
                    {formatMoney(plan.monthlyCents)}/month
                  </option>
                ))}
              </select>
              <button
                className="button-secondary mt-4"
                disabled={!targetPlanId || preview.isPending}
                onClick={() => preview.mutate()}
                type="button"
              >
                {preview.isPending ? 'Calculating…' : 'Preview plan change'}
              </button>
            </div>
          ) : !plans.isPending && !plans.isError ? (
            <p className="mt-5 text-slate-600">No other plans are currently available.</p>
          ) : null}

          {preview.data ? (
            <PlanChangeConfirmation
              preview={preview.data}
              submitting={requestChange.isPending}
              onConfirm={() => requestChange.mutate()}
            />
          ) : null}
          {mutationError ? (
            <p className="mt-5 rounded-md bg-rose-50 p-4 text-sm text-rose-800" role="alert">
              {mutationError instanceof ApiError
                ? mutationError.message
                : 'The plan change could not be completed.'}
            </p>
          ) : null}
        </section>
      ) : null}

      {subscriptions.data && !currentSubscription ? (
        <section className="mt-10">
          <p className="text-slate-600">
            Choose a plan below. Your service activates automatically after successful payment.
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {displayedPlans.map((plan) => (
              <article
                className={`rounded-xl border bg-white p-6 shadow-sm ${
                  plan.id === requestedPlanId
                    ? 'border-sky-400 ring-2 ring-sky-100'
                    : 'border-slate-200'
                }`}
                key={plan.id}
              >
                {plan.id === requestedPlanId ? (
                  <p className="mb-2 text-xs font-semibold tracking-wide text-sky-700">
                    SELECTED PLAN
                  </p>
                ) : null}
                <h2 className="text-xl font-bold text-slate-950">{plan.name}</h2>
                <p className="mt-3 min-h-12 text-slate-600">{plan.description}</p>
                <p className="mt-4 text-sm text-slate-600">
                  {plan.downloadMbps}/{plan.uploadMbps} Mbps
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-950">
                  {formatMoney(plan.monthlyCents)}
                  <span className="text-sm font-normal text-slate-500">/month, GST included</span>
                </p>
                <PlanCheckoutButton planId={plan.id} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function CheckoutReturnNotice({
  state,
  verifying,
  error,
  status,
}: Readonly<{
  state: 'success' | 'cancelled';
  verifying: boolean;
  error: boolean;
  status?: PlanChangeStatus;
}>) {
  const message =
    state === 'cancelled'
      ? 'Stripe Checkout was closed. Your existing subscription has not changed; you can continue the pending payment below.'
      : verifying
        ? 'Payment received. Verifying the paid Checkout and applying your upgrade…'
        : error
          ? 'Stripe recorded the payment, but automatic reconciliation could not finish. Your existing plan remains active; please retry below or contact support.'
          : status === 'APPLIED'
            ? 'Payment verified. Your upgraded plan is now active.'
            : 'Payment verification is still processing. Your existing plan remains active until it completes.';
  return (
    <p
      className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"
      role="status"
    >
      {message}
    </p>
  );
}

function PaymentReturnNotice({
  state,
  verifying,
  error,
  status,
}: Readonly<{
  state: 'success' | 'cancelled';
  verifying: boolean;
  error: boolean;
  status?: CheckoutStatus;
}>) {
  const message =
    state === 'cancelled'
      ? 'Stripe Checkout was closed without changing your subscription.'
      : verifying
        ? 'Payment received. Verifying your Checkout and activating the subscription…'
        : error
          ? 'Stripe returned a successful payment, but account reconciliation could not finish. Please retry your selected plan or contact support; do not pay again.'
          : status?.subscription?.status === 'ACTIVE'
            ? `${status.subscription.plan.name} is paid and active.`
            : 'Payment verification is still processing.';
  return (
    <p
      className={`mt-6 rounded-xl border p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
      role={error ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}

function CompletedPlanChange({ change }: Readonly<{ change: PlanChange }>) {
  if (change.status === 'APPLIED') {
    return (
      <p
        className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        role="status"
      >
        Your plan change from {change.currentPlan.name} to {change.targetPlan.name} is confirmed.
      </p>
    );
  }
  if (change.status === 'FAILED' || change.status === 'EXPIRED') {
    return (
      <p
        className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
        role="alert"
      >
        This plan change was not applied
        {change.failureReason ? `: ${change.failureReason.replaceAll('_', ' ').toLowerCase()}` : ''}
        . Your existing subscription was left unchanged.
      </p>
    );
  }
  if (change.status === 'CANCELLED') {
    return (
      <p
        className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
        role="status"
      >
        The scheduled downgrade was cancelled. Your existing plan remains active.
      </p>
    );
  }
  return null;
}

function PlanChangeConfirmation({
  preview,
  submitting,
  onConfirm,
}: Readonly<{
  preview: PlanChangePreview;
  submitting: boolean;
  onConfirm: () => void;
}>) {
  const upgrade = preview.type === 'UPGRADE';
  return (
    <div className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-5">
      <h3 className="text-lg font-semibold text-slate-950">
        {upgrade ? 'Upgrade preview' : 'Downgrade preview'}
      </h3>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <PlanCard label="Current plan" plan={preview.currentPlan} />
        <PlanCard label="New plan" plan={preview.targetPlan} />
      </div>
      {upgrade ? (
        <div className="mt-4 space-y-1 text-sm text-slate-700">
          <p>Unused current-plan credit: {formatMoney(preview.unusedCreditCents)}</p>
          <p>
            New-plan charge for the remaining period: {formatMoney(preview.proratedTargetCents)}
          </p>
          <p className="text-base font-semibold text-slate-950">
            Due today: {formatMoney(preview.amountPayableCents)} {preview.currency}
          </p>
          <p className="pt-2">Your new plan will start after payment is confirmed.</p>
          <p>The existing subscription remains active until payment succeeds.</p>
          <p>The displayed charge covers the remaining billing period.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-1 text-sm text-slate-700">
          <p className="font-semibold text-slate-950">
            Effective {formatDateTime(preview.effectiveAt)}
          </p>
          <p>Your current plan remains active until this billing date.</p>
          <p>The cheaper plan begins on that date. No immediate refund is provided.</p>
        </div>
      )}
      <button
        className="button-primary mt-5"
        disabled={submitting}
        onClick={onConfirm}
        type="button"
      >
        {submitting
          ? 'Submitting…'
          : upgrade
            ? `Continue to Stripe — ${formatMoney(preview.amountPayableCents)}`
            : 'Schedule downgrade'}
      </button>
    </div>
  );
}

function PendingPlanChange({
  change,
  cancelling,
  onCancel,
  onContinue,
}: Readonly<{
  change: PlanChange;
  cancelling: boolean;
  onCancel: () => void;
  onContinue: () => void;
}>) {
  const awaitingPayment = ['PENDING', 'CHECKOUT_CREATED', 'PROCESSING'].includes(change.status);
  return (
    <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5" aria-live="polite">
      <h2 className="font-semibold text-amber-950">
        {change.type === 'DOWNGRADE' ? 'Downgrade scheduled' : 'Upgrade awaiting payment'}
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        {change.currentPlan.name} → {change.targetPlan.name}
      </p>
      <p className="mt-1 text-sm text-amber-900">
        {change.type === 'DOWNGRADE'
          ? `Your current plan remains active until ${formatDateTime(change.effectiveAt)}.`
          : 'Your current plan remains active until Stripe confirms payment.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {change.status === 'SCHEDULED' ? (
          <button
            className="button-secondary"
            disabled={cancelling}
            onClick={onCancel}
            type="button"
          >
            {cancelling ? 'Cancelling…' : 'Cancel scheduled downgrade'}
          </button>
        ) : null}
        {awaitingPayment && change.status !== 'PROCESSING' ? (
          <button className="button-primary" onClick={onContinue} type="button">
            Continue payment
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PlanCard({ label, plan }: Readonly<{ label: string; plan: Plan }>) {
  return (
    <div className="rounded-lg bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold">{plan.name}</p>
      <p className="text-slate-600">
        {plan.downloadMbps}/{plan.uploadMbps} Mbps · {formatMoney(plan.monthlyCents)}/month
      </p>
    </div>
  );
}

function ErrorPanel({ message, retry }: Readonly<{ message: string; retry: () => unknown }>) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-rose-50 p-4 text-sm text-rose-800">
      <p>{message}</p>
      <button className="button-secondary" onClick={() => void retry()} type="button">
        Retry
      </button>
    </div>
  );
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-AU');
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' });
}
