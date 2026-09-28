'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { useAuth } from '../../../features/auth/auth-provider';
import { hasRole } from '../../../features/auth/auth-navigation';
import { CustomerCancellation } from '../../../features/cancellations/customer-cancellation';
import { PlanCheckoutButton } from '../../../features/payments/stripe-checkout-button';
import type { PublicInternetPlan } from '../../../features/plans/plan.types';
import { ApiError, apiRequest } from '../../../lib/api/client';

type Plan = PublicInternetPlan;

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
  currentPeriodStart: string;
  currentPeriodEnd: string;
  monthlyCents: number;
  billingMode: 'MANUAL' | 'STRIPE_RECURRING';
  stripeStatus?: string | null;
  nextBillingAt?: string | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodBrand?: string | null;
  paymentMethodLast4?: string | null;
  paymentMethodExpMonth?: number | null;
  paymentMethodExpYear?: number | null;
  pastDueAt?: string | null;
  gracePeriodEndsAt?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: 'NON_PAYMENT' | 'ADMINISTRATIVE' | 'FRAUD' | 'COMPLIANCE' | 'OTHER' | null;
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

type PaymentMethod = {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  createdAt: string | null;
  isDefault: boolean;
  isExpired: boolean;
  canRemove: boolean;
  removalBlockedReason: string | null;
};

type PaymentMethodsResult = {
  paymentMethods: PaymentMethod[];
  hasProtectedRecurringSubscription: boolean;
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
  const [recurringReturn, setRecurringReturn] = useState<'enabled' | 'cancelled' | null>(null);
  const [paymentMethodReturn, setPaymentMethodReturn] = useState<
    'added' | 'updated' | 'cancelled' | null
  >(null);
  const [paymentMethodStatus, setPaymentMethodStatus] = useState<string | null>(null);
  const [paymentMethodToRemove, setPaymentMethodToRemove] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planChange = params.get('planChange');
    const payment = params.get('payment');
    setRequestedPlanId(params.get('planId'));
    setCheckoutReturn(planChange === 'success' || planChange === 'cancelled' ? planChange : null);
    setPaymentReturn(payment === 'success' || payment === 'cancelled' ? payment : null);
    setCheckoutSessionId(params.get('sessionId'));
    setPlanChangeRequestId(params.get('requestId'));
    const recurring = params.get('recurring');
    setRecurringReturn(recurring === 'enabled' || recurring === 'cancelled' ? recurring : null);
    const paymentMethod = params.get('paymentMethod');
    setPaymentMethodReturn(
      paymentMethod === 'added' || paymentMethod === 'updated' || paymentMethod === 'cancelled'
        ? paymentMethod
        : null,
    );
  }, []);

  const subscriptions = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: () => apiRequest<Subscription[]>('/subscriptions/me', {}, accessToken),
    enabled: Boolean(accessToken && user && hasRole(user, 'CUSTOMER')),
  });
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<Plan[]>('/plans/public', {}, accessToken),
    enabled: Boolean(accessToken && user && hasRole(user, 'CUSTOMER')),
  });
  const enableRecurring = useMutation({
    mutationFn: (subscriptionId: string) =>
      apiRequest<{ checkoutUrl: string }>(
        '/payments/recurring-setup-session',
        { method: 'POST', body: JSON.stringify({ subscriptionId }) },
        accessToken,
      ),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
  });
  const openPortal = useMutation({
    mutationFn: () =>
      apiRequest<{ portalUrl: string }>(
        '/payments/customer-portal-session',
        { method: 'POST' },
        accessToken,
      ),
    onSuccess: ({ portalUrl }) => window.location.assign(portalUrl),
  });
  const currentSubscription = useMemo(
    () =>
      subscriptions.data?.find((subscription) =>
        [
          'ACTIVE',
          'PAST_DUE',
          'SUSPENDED',
          'CANCELLATION_PENDING',
          'DISCONNECTION_PENDING',
        ].includes(subscription.status),
      ),
    [subscriptions.data],
  );
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiRequest<PaymentMethodsResult>('/payments/payment-methods', {}, accessToken),
    enabled: Boolean(
      accessToken &&
      user &&
      hasRole(user, 'CUSTOMER') &&
      currentSubscription?.billingMode === 'STRIPE_RECURRING',
    ),
  });
  const defaultPaymentMethod = paymentMethods.data?.paymentMethods.find(
    (paymentMethod) => paymentMethod.isDefault,
  );
  const orderedPaymentMethods = useMemo(
    () =>
      [...(paymentMethods.data?.paymentMethods ?? [])].sort((left, right) => {
        if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
        const leftCreated = left.createdAt ? Date.parse(left.createdAt) : 0;
        const rightCreated = right.createdAt ? Date.parse(right.createdAt) : 0;
        return rightCreated - leftCreated;
      }),
    [paymentMethods.data?.paymentMethods],
  );
  const addPaymentMethod = useMutation({
    mutationFn: () =>
      apiRequest<{ checkoutUrl: string }>(
        '/payments/payment-methods/setup-session',
        { method: 'POST' },
        accessToken,
      ),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
  });
  const setDefaultPaymentMethod = useMutation({
    mutationFn: (paymentMethodId: string) =>
      apiRequest<{ updated: true }>(
        `/payments/payment-methods/${encodeURIComponent(paymentMethodId)}/default`,
        { method: 'POST' },
        accessToken,
      ),
    onMutate: () => setPaymentMethodStatus(null),
    onSuccess: async (_result, paymentMethodId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payment-methods'] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
      const method = paymentMethods.data?.paymentMethods.find(
        (paymentMethod) => paymentMethod.id === paymentMethodId,
      );
      setPaymentMethodStatus(
        `${method ? paymentMethodDisplayLabel(method) : 'Payment method'} is now the default for automatic payments.`,
      );
    },
  });
  const removePaymentMethod = useMutation({
    mutationFn: (paymentMethodId: string) =>
      apiRequest<{ removed: true }>(
        `/payments/payment-methods/${encodeURIComponent(paymentMethodId)}`,
        { method: 'DELETE' },
        accessToken,
      ),
    onMutate: () => setPaymentMethodStatus(null),
    onSuccess: async (_result, paymentMethodId) => {
      const method = paymentMethods.data?.paymentMethods.find(
        (paymentMethod) => paymentMethod.id === paymentMethodId,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payment-methods'] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
      setPaymentMethodStatus(
        `${method ? paymentMethodDisplayLabel(method) : 'Payment method'} was removed.`,
      );
    },
  });
  const paymentMethodActionPending =
    addPaymentMethod.isPending ||
    setDefaultPaymentMethod.isPending ||
    removePaymentMethod.isPending ||
    openPortal.isPending;
  const cancellationSubscription = useMemo(
    () =>
      currentSubscription ??
      subscriptions.data?.find((subscription) => subscription.status === 'CANCELLED'),
    [currentSubscription, subscriptions.data],
  );
  const latestChange = useQuery({
    queryKey: ['plan-change'],
    queryFn: () =>
      apiRequest<{ data: PlanChange[] }>('/plan-change-requests/me?limit=1', {}, accessToken),
    select: (result) => result.data[0] ?? null,
    enabled: Boolean(accessToken && user && hasRole(user, 'CUSTOMER')),
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
      accessToken &&
      user &&
      hasRole(user, 'CUSTOMER') &&
      paymentReturn === 'success' &&
      checkoutSessionId,
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
      user &&
      hasRole(user, 'CUSTOMER') &&
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

  useEffect(() => {
    if (paymentMethodReturn !== 'added' && paymentMethodReturn !== 'updated') return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payment-methods'] }),
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
    ]);
  }, [paymentMethodReturn, queryClient]);

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
      <main className="grid min-h-screen place-items-center text-muted-foreground">
        Checking your session…
      </main>
    );
  }
  if (!user || !hasRole(user, 'CUSTOMER')) {
    return (
      <main className="grid min-h-screen place-items-center text-muted-foreground">
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
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-sm font-semibold tracking-wide text-primary">MY INTERNET</p>
          <h1 className="mt-2 text-3xl font-bold">My subscription</h1>
        </div>
      </header>

      {subscriptions.isPending ? (
        <p className="mt-6 text-muted-foreground">Loading your subscription…</p>
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
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
            key={subscription.id}
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <h2 className="font-semibold text-foreground">{subscription.plan.name}</h2>
                <p className="mt-2 text-muted-foreground">
                  {subscription.plan.downloadMbps}/{subscription.plan.uploadMbps} Mbps ·{' '}
                  {formatMoney(subscription.monthlyCents)}/month
                </p>
              </div>
              <span
                className={`h-fit rounded-full px-2.5 py-1 text-xs font-semibold ${subscriptionStatusTone(subscription.status)}`}
              >
                {subscriptionStatusLabel(subscription.status)}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Started {formatDate(subscription.startDate)}
              {subscription.status === 'ACTIVE'
                ? ` · Current billing period ends ${formatDate(subscription.currentPeriodEnd)}`
                : ''}
            </p>
          </article>
        ))}
      </div>

      {recurringReturn ? (
        <p
          className={`mt-6 rounded-md p-3 text-sm ${
            recurringReturn === 'enabled'
              ? 'bg-success-subtle text-success-foreground'
              : 'bg-warning-subtle text-warning-foreground'
          }`}
          role="status"
        >
          {recurringReturn === 'enabled'
            ? 'Your payment method was saved. Automatic billing is being activated.'
            : 'Automatic payment setup was cancelled; your existing billing arrangement is unchanged.'}
        </p>
      ) : null}

      {paymentMethodReturn ? (
        <p
          className={`mt-6 rounded-md p-3 text-sm ${
            paymentMethodReturn === 'cancelled'
              ? 'bg-warning-subtle text-warning-foreground'
              : 'bg-success-subtle text-success-foreground'
          }`}
          role="status"
        >
          {paymentMethodReturn === 'cancelled'
            ? 'Payment method setup was cancelled. Your existing automatic payment settings are unchanged.'
            : paymentMethodReturn === 'added'
              ? 'Your payment method was added and set as the default for future automatic payments. If a payment previously failed, Stripe is retrying that same invoice.'
              : 'Your payment method was updated securely. If a payment previously failed, Stripe is retrying that same invoice.'}
        </p>
      ) : null}

      {currentSubscription ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-semibold tracking-wide text-primary">BILLING</p>
          <h2 className="mt-2 text-2xl font-bold text-foreground">Automatic payments</h2>
          {currentSubscription.billingMode === 'STRIPE_RECURRING' ? (
            <>
              <p className="mt-2 text-muted-foreground">
                Your saved payment method will be automatically charged on your billing date.
              </p>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <BillingDetail label="Automatic payments" value="On" />
                <BillingDetail label="Billing cycle" value="Monthly" />
                <BillingDetail
                  label="Subscription"
                  value={subscriptionStatusLabel(currentSubscription.status)}
                />
                <BillingDetail
                  label="Next payment date"
                  value={
                    currentSubscription.cancelAtPeriodEnd
                      ? 'No further charge scheduled'
                      : currentSubscription.nextBillingAt
                        ? formatDate(currentSubscription.nextBillingAt)
                        : formatDate(currentSubscription.currentPeriodEnd)
                  }
                />
                <BillingDetail
                  label="Next automatic payment"
                  value={
                    currentSubscription.cancelAtPeriodEnd
                      ? 'No further charge scheduled'
                      : `${formatMoney(currentSubscription.monthlyCents)} AUD`
                  }
                />
                <BillingDetail
                  label="Payment method"
                  value={
                    defaultPaymentMethod
                      ? paymentMethodDisplayLabel(defaultPaymentMethod)
                      : paymentMethodLabel(currentSubscription)
                  }
                />
                <BillingDetail
                  label="Billing status"
                  value={stripeBillingStatusLabel(currentSubscription.stripeStatus)}
                />
                <BillingDetail
                  label="Cancellation"
                  value={
                    currentSubscription.cancelAtPeriodEnd
                      ? 'Ends after paid period'
                      : 'Not scheduled'
                  }
                />
              </dl>
              {currentSubscription.status === 'PAST_DUE' ||
              (currentSubscription.status === 'SUSPENDED' &&
                currentSubscription.suspensionReason === 'NON_PAYMENT') ? (
                <div className="mt-5 rounded-xl border border-destructive-border bg-destructive-subtle p-4 text-destructive-foreground">
                  <p className="font-semibold">Automatic payment failed</p>
                  <p className="mt-1 text-sm">
                    Add or choose a working payment method. Stripe will retry the existing unpaid
                    invoice; a duplicate invoice will not be created.
                  </p>
                  <button
                    className="button-primary mt-4"
                    disabled={paymentMethodActionPending}
                    onClick={() => addPaymentMethod.mutate()}
                    type="button"
                  >
                    {addPaymentMethod.isPending ? 'Opening Stripe…' : 'Update payment method'}
                  </button>
                </div>
              ) : null}
              <div className="mt-6 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-foreground">Saved payment methods</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Payment details are stored securely by Stripe. A new method becomes the
                      default for future automatic payments.
                    </p>
                  </div>
                  <button
                    className="button-primary"
                    disabled={paymentMethodActionPending}
                    onClick={() => {
                      setPaymentMethodStatus(null);
                      addPaymentMethod.mutate();
                    }}
                    type="button"
                  >
                    {addPaymentMethod.isPending ? 'Opening Stripe…' : 'Add payment method'}
                  </button>
                </div>
                {paymentMethods.isPending ? (
                  <p className="mt-4 text-sm text-muted-foreground">Loading payment methods…</p>
                ) : null}
                {paymentMethods.isError ? (
                  <ErrorPanel
                    message="Unable to load saved payment methods."
                    retry={() => paymentMethods.refetch()}
                  />
                ) : null}
                {paymentMethodStatus ? (
                  <p
                    className="mt-4 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-sm text-success-foreground"
                    role="status"
                  >
                    {paymentMethodStatus}
                  </p>
                ) : null}
                {defaultPaymentMethod?.isExpired ? (
                  <div
                    className="mt-4 rounded-xl border border-warning-border bg-warning-subtle p-4 text-warning-foreground"
                    role="alert"
                  >
                    <p className="font-semibold">Your default payment method has expired</p>
                    <p className="mt-1 text-sm">
                      Add a current payment method before your next billing date to avoid a failed
                      automatic payment.
                    </p>
                  </div>
                ) : null}
                <div aria-busy={paymentMethodActionPending} className="mt-4 space-y-3">
                  {orderedPaymentMethods.map((method) => (
                    <PaymentMethodCard
                      actionsDisabled={paymentMethodActionPending}
                      defaulting={
                        setDefaultPaymentMethod.isPending &&
                        setDefaultPaymentMethod.variables === method.id
                      }
                      key={method.id}
                      method={method}
                      onRemove={() => setPaymentMethodToRemove(method)}
                      onSetDefault={() => {
                        setPaymentMethodStatus(null);
                        setDefaultPaymentMethod.mutate(method.id);
                      }}
                      removing={
                        removePaymentMethod.isPending && removePaymentMethod.variables === method.id
                      }
                    />
                  ))}
                </div>
                {paymentMethods.data?.paymentMethods.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-warning-border bg-warning-subtle p-4 text-warning-foreground">
                    <p className="font-semibold">No payment method saved</p>
                    <p className="mt-1 text-sm">
                      Add one before your next billing date to keep automatic payments working.
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  className="button-secondary"
                  disabled={paymentMethodActionPending}
                  onClick={() => openPortal.mutate()}
                  type="button"
                >
                  {openPortal.isPending ? 'Opening Stripe…' : 'Update payment method in Stripe'}
                </button>
                <Link className="button-secondary" href="/customer/invoices">
                  View invoices
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-muted-foreground">
                This is an existing manual-payment subscription. Add a payment method to enable
                automatic monthly charges from your next billing date.
              </p>
              <button
                className="button-primary mt-5"
                disabled={enableRecurring.isPending}
                onClick={() => enableRecurring.mutate(currentSubscription.id)}
                type="button"
              >
                {enableRecurring.isPending ? 'Opening Stripe…' : 'Enable automatic payments'}
              </button>
            </>
          )}
          {enableRecurring.error ||
          openPortal.error ||
          addPaymentMethod.error ||
          setDefaultPaymentMethod.error ||
          removePaymentMethod.error ? (
            <p className="mt-3 text-sm text-destructive-foreground" role="alert">
              {errorText(
                enableRecurring.error ??
                  openPortal.error ??
                  addPaymentMethod.error ??
                  setDefaultPaymentMethod.error ??
                  removePaymentMethod.error,
              )}
            </p>
          ) : null}
        </section>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !removePaymentMethod.isPending) setPaymentMethodToRemove(null);
        }}
        open={Boolean(paymentMethodToRemove)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment method?</AlertDialogTitle>
            <AlertDialogDescription>
              {paymentMethodToRemove
                ? `${paymentMethodDisplayLabel(paymentMethodToRemove)} will no longer be available for future payments. This does not cancel your subscription.`
                : 'This payment method will no longer be available for future payments.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePaymentMethod.isPending}>
              Keep method
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removePaymentMethod.isPending}
              onClick={() => {
                if (!paymentMethodToRemove) return;
                removePaymentMethod.mutate(paymentMethodToRemove.id);
                setPaymentMethodToRemove(null);
              }}
            >
              Remove payment method
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {currentSubscription?.status === 'ACTIVE' ? (
        <section className="mt-6 rounded-2xl border border-primary/20 bg-primary-subtle p-6">
          <p className="text-sm font-semibold tracking-wide text-primary">MOVING HOME?</p>
          <h2 className="mt-2 text-2xl font-bold text-foreground">
            Transfer your internet service
          </h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Transfer your Mero Telecom service to your new address. We’ll check service availability
            before making any changes to your existing connection.
          </p>
          <Link
            className="button-primary mt-5 inline-flex"
            href="/customer/subscription/moving-home"
          >
            Move my service
          </Link>
        </section>
      ) : null}

      {cancellationSubscription ? (
        <CustomerCancellation accessToken={accessToken} subscription={cancellationSubscription} />
      ) : null}

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
        <div className="mt-6 rounded-xl border border-destructive-border bg-destructive-subtle p-4 text-destructive-foreground">
          <p className="font-semibold">Service suspended</p>
          <p className="mt-1 text-sm">
            {currentSubscription.suspensionReason === 'NON_PAYMENT'
              ? 'Your service is suspended due to an outstanding payment. Pay the overdue balance to begin restoration.'
              : 'Plan changes are unavailable while this service is suspended. Contact support for assistance.'}
          </p>
          <a
            className="button-primary mt-4 inline-flex"
            href={
              currentSubscription.suspensionReason === 'NON_PAYMENT'
                ? '/customer/invoices'
                : '/customer/support'
            }
          >
            {currentSubscription.suspensionReason === 'NON_PAYMENT'
              ? 'Pay overdue balance'
              : 'Contact support'}
          </a>
        </div>
      ) : null}

      {currentSubscription?.status === 'PAST_DUE' ? (
        <div className="mt-6 rounded-xl border border-warning-border bg-warning-subtle p-4 text-warning-foreground">
          <p className="font-semibold">Payment overdue</p>
          <p className="mt-1 text-sm">
            Your internet service remains active
            {currentSubscription.gracePeriodEndsAt
              ? ` until ${formatDate(currentSubscription.gracePeriodEndsAt)}`
              : ' during the grace period'}
            . Pay the overdue balance to avoid suspension. Plan changes are unavailable until your
            account is up to date.
          </p>
          <a className="button-primary mt-4 inline-flex" href="/customer/invoices">
            Pay now
          </a>
        </div>
      ) : null}

      {currentSubscription?.status === 'ACTIVE' && !pendingChange ? (
        <section className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-sm font-semibold tracking-wide text-primary">CHANGE PLAN</p>
          <h2 className="mt-2 text-2xl font-bold text-foreground">Upgrade or downgrade</h2>
          <p className="mt-2 text-muted-foreground">
            Choose an available plan. Pricing and any prorated charge are calculated securely by the
            server.
          </p>

          {requestedPlanId === currentSubscription.plan.id ? (
            <p className="mt-5 rounded-xl border border-primary/20 bg-primary-subtle p-4 text-sm text-primary-hover">
              {currentSubscription.plan.name} is already your current plan. Choose another plan to
              upgrade or downgrade.
            </p>
          ) : null}

          {plans.isPending ? (
            <p className="mt-5 text-muted-foreground">Loading available plans…</p>
          ) : null}
          {plans.isError ? (
            <ErrorPanel message="Unable to load available plans." retry={() => plans.refetch()} />
          ) : null}
          {availableTargets.length ? (
            <div className="mt-5">
              <label className="block text-sm font-medium text-foreground" htmlFor="target-plan">
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
            <p className="mt-5 text-muted-foreground">No other plans are currently available.</p>
          ) : null}

          {preview.data ? (
            <PlanChangeConfirmation
              preview={preview.data}
              submitting={requestChange.isPending}
              onConfirm={() => requestChange.mutate()}
            />
          ) : null}
          {mutationError ? (
            <p
              className="mt-5 rounded-md bg-destructive-subtle p-4 text-sm text-destructive-foreground"
              role="alert"
            >
              {mutationError instanceof ApiError
                ? mutationError.message
                : 'The plan change could not be completed.'}
            </p>
          ) : null}
        </section>
      ) : null}

      {subscriptions.data && !currentSubscription ? (
        <section className="mt-10">
          <p className="text-muted-foreground">
            Choose a plan below. Your service activates automatically after successful payment.
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {displayedPlans.map((plan) => (
              <article
                className={`rounded-xl border bg-card p-6 shadow-sm ${
                  plan.id === requestedPlanId
                    ? 'border-primary/40 ring-2 ring-primary/15'
                    : 'border-border'
                }`}
                key={plan.id}
              >
                {plan.id === requestedPlanId ? (
                  <p className="mb-2 text-xs font-semibold tracking-wide text-primary">
                    SELECTED PLAN
                  </p>
                ) : null}
                <h2 className="text-xl font-bold text-foreground">{plan.name}</h2>
                <p className="mt-3 min-h-12 text-muted-foreground">{plan.description}</p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {plan.downloadMbps}/{plan.uploadMbps} Mbps
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground">
                  {formatMoney(plan.monthlyCents)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /month, GST included
                  </span>
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
      className="mt-6 rounded-xl border border-primary/20 bg-primary-subtle p-4 text-sm text-primary-hover"
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
      className={`mt-6 rounded-xl border p-4 text-sm ${error ? 'border-destructive-border bg-destructive-subtle text-destructive-foreground' : 'border-primary/20 bg-primary-subtle text-primary-hover'}`}
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
        className="mt-6 rounded-xl border border-success-border bg-success-subtle p-4 text-sm text-success-foreground"
        role="status"
      >
        Your plan change from {change.currentPlan.name} to {change.targetPlan.name} is confirmed.
      </p>
    );
  }
  if (change.status === 'FAILED' || change.status === 'EXPIRED') {
    return (
      <p
        className="mt-6 rounded-xl border border-destructive-border bg-destructive-subtle p-4 text-sm text-destructive-foreground"
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
        className="mt-6 rounded-xl border border-border bg-muted p-4 text-sm text-foreground"
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
    <div className="mt-6 rounded-xl border border-primary/20 bg-primary-subtle p-5">
      <h3 className="text-lg font-semibold text-foreground">
        {upgrade ? 'Upgrade preview' : 'Downgrade preview'}
      </h3>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <PlanCard label="Current plan" plan={preview.currentPlan} />
        <PlanCard label="New plan" plan={preview.targetPlan} />
      </div>
      {upgrade ? (
        <div className="mt-4 space-y-1 text-sm text-foreground">
          <p>Unused current-plan credit: {formatMoney(preview.unusedCreditCents)}</p>
          <p>
            New-plan charge for the remaining period: {formatMoney(preview.proratedTargetCents)}
          </p>
          <p className="text-base font-semibold text-foreground">
            Due today: {formatMoney(preview.amountPayableCents)} {preview.currency}
          </p>
          <p className="pt-2">Your new plan will start after payment is confirmed.</p>
          <p>The existing subscription remains active until payment succeeds.</p>
          <p>The displayed charge covers the remaining billing period.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-1 text-sm text-foreground">
          <p className="font-semibold text-foreground">
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
    <section
      className="mt-6 rounded-xl border border-warning-border bg-warning-subtle p-5"
      aria-live="polite"
    >
      <h2 className="font-semibold text-warning-foreground">
        {change.type === 'DOWNGRADE' ? 'Downgrade scheduled' : 'Upgrade awaiting payment'}
      </h2>
      <p className="mt-2 text-sm text-warning-foreground">
        {change.currentPlan.name} → {change.targetPlan.name}
      </p>
      <p className="mt-1 text-sm text-warning-foreground">
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
    <div className="rounded-lg bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{plan.name}</p>
      <p className="text-muted-foreground">
        {plan.downloadMbps}/{plan.uploadMbps} Mbps · {formatMoney(plan.monthlyCents)}/month
      </p>
    </div>
  );
}

function ErrorPanel({ message, retry }: Readonly<{ message: string; retry: () => unknown }>) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md bg-destructive-subtle p-4 text-sm text-destructive-foreground">
      <p>{message}</p>
      <button className="button-secondary" onClick={() => void retry()} type="button">
        Retry
      </button>
    </div>
  );
}

function PaymentMethodCard({
  method,
  actionsDisabled,
  defaulting,
  removing,
  onSetDefault,
  onRemove,
}: Readonly<{
  method: PaymentMethod;
  actionsDisabled: boolean;
  defaulting: boolean;
  removing: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}>) {
  const isCard = method.type === 'card';
  const expiry =
    method.expMonth && method.expYear
      ? `${String(method.expMonth).padStart(2, '0')}/${String(method.expYear).slice(-2)}`
      : null;
  const label = paymentMethodDisplayLabel(method);
  return (
    <article
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
    >
      <div>
        <p className="font-medium text-foreground">
          {label}
          {method.isDefault ? (
            <span className="ml-2 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success-foreground">
              Default
            </span>
          ) : null}
        </p>
        {isCard ? (
          <p
            className={`mt-1 text-sm ${method.isExpired ? 'text-destructive-foreground' : 'text-muted-foreground'}`}
          >
            {method.isExpired ? 'Expired' : expiry ? 'Expires' : 'Expiry unavailable'}{' '}
            {expiry ?? ''}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Managed securely by Stripe</p>
        )}
        {method.isExpired ? (
          <p className="mt-1 text-xs text-destructive-foreground">
            This card can’t be used for future payments. Add a current payment method.
          </p>
        ) : null}
        {!method.canRemove && method.removalBlockedReason ? (
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            {method.removalBlockedReason}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {!method.isDefault && !method.isExpired ? (
          <button
            aria-label={`Set ${label} as default`}
            className="button-secondary"
            disabled={actionsDisabled}
            onClick={onSetDefault}
            type="button"
          >
            {defaulting ? 'Updating…' : 'Set as default'}
          </button>
        ) : null}
        <button
          aria-label={`Remove ${label}`}
          className="button-secondary text-destructive-foreground"
          disabled={!method.canRemove || actionsDisabled}
          onClick={onRemove}
          type="button"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </article>
  );
}

function paymentMethodDisplayLabel(method: PaymentMethod): string {
  if (method.type === 'card') {
    const brand = method.brand
      ? `${method.brand.slice(0, 1).toUpperCase()}${method.brand.slice(1)}`
      : 'Card';
    return `${brand} •••• ${method.last4 ?? '••••'}`;
  }
  if (method.type === 'link') return 'Link';
  return method.type
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function BillingDetail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function paymentMethodLabel(subscription: Subscription): string {
  if (!subscription.paymentMethodLast4) return 'Managed securely by Stripe';
  const brand = subscription.paymentMethodBrand
    ? `${subscription.paymentMethodBrand.slice(0, 1).toUpperCase()}${subscription.paymentMethodBrand.slice(1)}`
    : 'Card';
  const expiry =
    subscription.paymentMethodExpMonth && subscription.paymentMethodExpYear
      ? ` · expires ${String(subscription.paymentMethodExpMonth).padStart(2, '0')}/${String(subscription.paymentMethodExpYear).slice(-2)}`
      : '';
  return `${brand} •••• ${subscription.paymentMethodLast4}${expiry}`;
}

function stripeBillingStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Synchronizing';
  const labels: Record<string, string> = {
    active: 'Active',
    canceled: 'Cancelled',
    incomplete: 'Setup incomplete',
    incomplete_expired: 'Setup expired',
    past_due: 'Payment overdue',
    paused: 'Paused',
    trialing: 'Trial period',
    unpaid: 'Payment required',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The billing action could not be completed.';
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-AU');
}

function subscriptionStatusLabel(status: Subscription['status']): string {
  const labels: Record<Subscription['status'], string> = {
    PENDING: 'Pending activation',
    ACTIVE: 'Active',
    PAST_DUE: 'Past due',
    SUSPENDED: 'Suspended',
    CANCELLATION_PENDING: 'Cancellation scheduled',
    DISCONNECTION_PENDING: 'Cancellation in progress',
    CANCELLED: 'Ended',
    TERMINATED: 'Terminated',
  };
  return labels[status];
}

function subscriptionStatusTone(status: Subscription['status']): string {
  if (status === 'ACTIVE') return 'bg-success-subtle text-success-foreground';
  if (status === 'PAST_DUE') return 'bg-destructive-subtle text-destructive-foreground';
  if (status === 'CANCELLATION_PENDING') return 'bg-warning-subtle text-warning-foreground';
  if (status === 'PENDING') return 'bg-warning-subtle text-warning-foreground';
  if (status === 'SUSPENDED') return 'bg-warning-subtle text-warning-foreground';
  return 'bg-destructive-subtle text-destructive-foreground';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' });
}
