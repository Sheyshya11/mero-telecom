'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ApiError, apiRequest } from '../../lib/api/client';
import { hasRole } from '../auth/auth-navigation';
import { useAuth } from '../auth/auth-provider';
import { AddressAutocomplete } from '../coverage/address-autocomplete';
import type { AddressSuggestion } from '../coverage/coverage.types';
import type {
  RelocationQualification,
  RelocationSubscription,
  ServiceAddress,
  ServiceRelocation,
} from './relocation.types';

const steps = ['New Address', 'Availability', 'Plan', 'Move Date', 'Review', 'Confirmation'];
const activeStatuses = [
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PROVISIONING',
  'SCHEDULED',
  'FAILED',
];

export function MovingHome() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [billingSameAsService, setBillingSameAsService] = useState(true);
  const [selectedBillingAddress, setSelectedBillingAddress] = useState<AddressSuggestion | null>(
    null,
  );
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [moveDate, setMoveDate] = useState('');
  const [startNew, setStartNew] = useState(false);

  const subscriptions = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: () => apiRequest<RelocationSubscription[]>('/subscriptions/me', {}, accessToken),
    enabled: Boolean(accessToken && user && hasRole(user, 'CUSTOMER')),
  });
  const subscription = useMemo(
    () => subscriptions.data?.find((item) => item.status === 'ACTIVE') ?? null,
    [subscriptions.data],
  );
  const currentRelocation = useQuery({
    queryKey: ['current-relocation', subscription?.id],
    queryFn: async () =>
      (await apiRequest<ServiceRelocation | null | undefined>(
        `/subscriptions/${subscription!.id}/relocations/current`,
        {},
        accessToken,
      )) ?? null,
    enabled: Boolean(accessToken && subscription),
    retry: false,
  });
  const qualification = useMutation({
    mutationFn: (selectionToken: string) =>
      apiRequest<RelocationQualification>(
        `/subscriptions/${subscription!.id}/relocations/qualification`,
        { method: 'POST', body: JSON.stringify({ selectionToken }) },
        accessToken,
      ),
    onSuccess: (result) => {
      setSelectedPlanId(
        result.currentPlanCompatible ? result.currentPlanId : (result.plans[0]?.id ?? ''),
      );
      setStep(1);
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<ServiceRelocation>(
        `/subscriptions/${subscription!.id}/relocations`,
        {
          method: 'POST',
          body: JSON.stringify({
            qualificationToken: qualification.data!.qualificationToken,
            requestedPlanId: selectedPlanId,
            requestedMoveDate: moveDate,
            billingSameAsService,
            billingAddressSelectionToken: billingSameAsService
              ? undefined
              : selectedBillingAddress?.selectionToken,
          }),
        },
        accessToken,
      );
      return apiRequest<ServiceRelocation>(
        `/relocations/${created.id}/confirm`,
        { method: 'POST' },
        accessToken,
      );
    },
    onSuccess: async () => {
      setStep(5);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['current-relocation', subscription?.id] }),
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
      ]);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      apiRequest<ServiceRelocation>(`/relocations/${id}/cancel`, { method: 'POST' }, accessToken),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['current-relocation', subscription?.id] }),
  });

  if (isLoading || subscriptions.isPending)
    return <Status message="Loading your internet service…" />;
  if (!user || !hasRole(user, 'CUSTOMER')) return <Status message="Customer access is required." />;
  if (subscriptions.isError) return <Status message="Unable to load your internet service." />;
  if (!subscription) {
    return (
      <Shell>
        <Notice title="An active service is required">
          Moving Home is available for active internet subscriptions. Your existing service is never
          changed by an availability check.
        </Notice>
      </Shell>
    );
  }

  const existing = currentRelocation.data;
  if (
    existing &&
    !startNew &&
    (activeStatuses.includes(existing.status) || existing.status === 'COMPLETED')
  ) {
    return (
      <Shell>
        <RelocationStatusCard
          relocation={existing}
          cancelling={cancel.isPending}
          onCancel={() => cancel.mutate(existing.id)}
          onStartNew={existing.status === 'COMPLETED' ? () => setStartNew(true) : undefined}
        />
      </Shell>
    );
  }

  const result = qualification.data;
  const selectedPlan = result?.plans.find((plan) => plan.id === selectedPlanId);
  const earliestDate = new Date().toISOString().slice(0, 10);

  return (
    <Shell>
      <ol className="grid gap-2 sm:grid-cols-6" aria-label="Relocation progress">
        {steps.map((label, index) => (
          <li
            className={`rounded-lg border px-3 py-2 text-center text-xs font-semibold ${
              index <= step
                ? 'border-primary/30 bg-primary-subtle text-primary-hover'
                : 'border-border text-muted-foreground'
            }`}
            key={label}
          >
            <span className="block">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-bold">Where are you moving?</h2>
          <p className="mt-2 text-muted-foreground">
            Select a verified address. This check does not change or disconnect your current
            service.
          </p>
          <div className="mt-5">
            <AddressAutocomplete
              label="New service address"
              onSelectionChange={(address) => {
                setSelectedAddress(address);
                qualification.reset();
              }}
              selectedMessage="New address selected. Ready to check availability."
            />
          </div>
          {selectedAddress ? <AddressDetails address={selectedAddress} /> : null}
          <button
            className="button-primary mt-4"
            disabled={!selectedAddress || qualification.isPending}
            onClick={() => selectedAddress && qualification.mutate(selectedAddress.selectionToken)}
            type="button"
          >
            {qualification.isPending ? 'Checking availability…' : 'Check availability'}
          </button>
          <MutationError error={qualification.error} />
        </section>
      ) : null}

      {step === 1 && result ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-bold">Availability</h2>
          <div
            className={`mt-4 rounded-xl border p-5 ${result.available ? 'border-success-border bg-success-subtle' : 'border-warning-border bg-warning-subtle'}`}
          >
            <p className="font-semibold">{result.address.formattedAddress}</p>
            <p className="mt-2 text-sm">{result.message}</p>
            {result.available ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <Detail
                  label="NBN technology"
                  value={result.qualification.technology ?? 'Needs confirmation'}
                />
                <Detail
                  label="Estimated maximum speed"
                  value={
                    result.qualification.maximumSpeedMbps
                      ? `${result.qualification.maximumSpeedMbps} Mbps`
                      : 'Needs confirmation'
                  }
                />
              </dl>
            ) : null}
          </div>
          {!result.available ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button className="button-secondary" onClick={() => setStep(0)} type="button">
                Try another address
              </button>
              <Link className="button-primary" href="/customer/support">
                Contact support
              </Link>
            </div>
          ) : (
            <button className="button-primary mt-5" onClick={() => setStep(2)} type="button">
              Continue to plan
            </button>
          )}
        </section>
      ) : null}

      {step === 2 && result ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-bold">Choose the plan at your new home</h2>
          <p className="mt-2 text-muted-foreground">
            {result.currentPlanCompatible
              ? 'Your current plan is compatible with the new premises.'
              : 'Your current plan is unavailable at the new premises. Choose a compatible alternative.'}
          </p>
          <div className="mt-5 grid gap-3">
            {result.plans.map((plan) => (
              <label
                className="flex cursor-pointer gap-3 rounded-xl border border-border p-4"
                key={plan.id}
              >
                <input
                  checked={selectedPlanId === plan.id}
                  name="relocation-plan"
                  onChange={() => setSelectedPlanId(plan.id)}
                  type="radio"
                />
                <span>
                  <span className="font-semibold">
                    {plan.id === result.currentPlanId ? `Keep ${plan.name}` : plan.name}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {plan.downloadMbps}/{plan.uploadMbps} Mbps · {formatMoney(plan.monthlyCents)}
                    /month
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button
            className="button-primary mt-5"
            disabled={!selectedPlanId}
            onClick={() => setStep(3)}
            type="button"
          >
            Continue to move date
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-bold">When are you moving?</h2>
          <p className="mt-2 text-muted-foreground">
            Your existing service stays active until the new service is successfully provisioned and
            the old-service disconnection is processed.
          </p>
          <label className="mt-5 block max-w-sm text-sm font-medium">
            Requested activation date
            <input
              className="field mt-1"
              min={earliestDate}
              onChange={(event) => setMoveDate(event.target.value)}
              type="date"
              value={moveDate}
            />
          </label>
          <button
            className="button-primary mt-5"
            disabled={!moveDate}
            onClick={() => setStep(4)}
            type="button"
          >
            Review move
          </button>
        </section>
      ) : null}

      {step === 4 && result && selectedPlan ? (
        <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-bold">Review your relocation</h2>
          <fieldset className="mt-5 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold text-foreground">Billing address</legend>
            <label className="flex items-start gap-3 text-sm text-foreground">
              <input
                aria-label="Use the new service address for billing"
                checked={billingSameAsService}
                className="mt-1"
                onChange={(event) => {
                  setBillingSameAsService(event.target.checked);
                  if (event.target.checked) setSelectedBillingAddress(null);
                }}
                type="checkbox"
              />
              <span>
                <span className="font-medium">Use the new service address for billing</span>
                <span className="mt-1 block text-muted-foreground">
                  Turn this off if bills should use a different complete address.
                </span>
              </span>
            </label>
            {!billingSameAsService ? (
              <div className="mt-4">
                <AddressAutocomplete
                  label="Billing address"
                  onSelectionChange={setSelectedBillingAddress}
                  placeholder="Start typing the complete billing address"
                  selectedMessage="Billing address selected."
                />
                {selectedBillingAddress ? (
                  <AddressDetails address={selectedBillingAddress} />
                ) : null}
              </div>
            ) : null}
          </fieldset>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Detail label="Moving from" value={formatAddress(subscription.currentServiceAddress)} />
            <Detail label="Moving to" value={result.address.formattedAddress} />
            <Detail
              label="Billing address"
              value={
                billingSameAsService
                  ? (selectedAddress?.formattedAddress ?? result.address.formattedAddress)
                  : (selectedBillingAddress?.formattedAddress ?? 'Select a billing address')
              }
            />
            <Detail label="Current plan" value={subscription.plan.name} />
            <Detail
              label="Plan at new home"
              value={
                selectedPlan.id === subscription.plan.id
                  ? `Keep ${selectedPlan.name}`
                  : selectedPlan.name
              }
            />
            <Detail label="Requested activation" value={formatDate(moveDate)} />
            <Detail
              label="Old service"
              value="Remains active until relocation and disconnection processing completes."
            />
          </dl>
          <p className="mt-5 rounded-lg border border-info-border bg-info-subtle p-4 text-sm text-info-foreground">
            Confirming starts the relocation workflow. It does not cancel your subscription or
            immediately overwrite your active service address.
          </p>
          <button
            className="button-primary mt-5"
            disabled={submit.isPending || (!billingSameAsService && !selectedBillingAddress)}
            onClick={() => submit.mutate()}
            type="button"
          >
            {submit.isPending ? 'Confirming move…' : 'Confirm move'}
          </button>
          <MutationError error={submit.error} />
        </section>
      ) : null}

      {step === 5 ? (
        <Notice title="Your relocation is confirmed">
          We’ll keep your current connection active while the new service is provisioned. You can
          return here at any time to see its status.
        </Notice>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="workspace-page mx-auto min-h-screen max-w-4xl px-6 py-10">
      <header className="border-b border-border pb-6">
        <p className="text-sm font-semibold tracking-wide text-primary">MY INTERNET</p>
        <h1 className="mt-2 text-3xl font-bold">Moving Home</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Transfer your Mero Telecom service to your new address. We’ll check service availability
          before making any changes to your existing connection.
        </p>
      </header>
      <div className="mt-7">{children}</div>
    </main>
  );
}

function RelocationStatusCard({
  relocation,
  cancelling,
  onCancel,
  onStartNew,
}: Readonly<{
  relocation: ServiceRelocation;
  cancelling: boolean;
  onCancel: () => void;
  onStartNew?: () => void;
}>) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">MOVING HOME</p>
          <h2 className="mt-1 text-2xl font-bold">
            {relocation.status === 'COMPLETED' ? 'Relocation complete' : 'Relocation in progress'}
          </h2>
        </div>
        <span className="rounded-full bg-primary-subtle px-3 py-1 text-xs font-bold text-primary-hover">
          {friendly(relocation.status)}
        </span>
      </div>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Detail label="Old address" value={formatAddress(relocation.oldServiceAddress)} />
        <Detail label="New address" value={formatAddress(relocation.newServiceAddress)} />
        <Detail label="Plan" value={relocation.requestedPlan.name} />
        <Detail label="Requested move" value={formatDate(relocation.requestedMoveDate)} />
      </dl>
      <p className="mt-5 rounded-lg border border-info-border bg-info-subtle p-4 text-sm text-info-foreground">
        {relocation.status === 'COMPLETED'
          ? 'Your new service address is active and the previous service was closed through the relocation workflow.'
          : 'Your existing subscription and service address remain active until the new service has been successfully provisioned.'}
      </p>
      {relocation.failureReason ? (
        <p className="mt-4 rounded-lg bg-destructive-subtle p-4 text-sm text-destructive-foreground">
          {relocation.failureReason}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {relocation.canCancel ? (
          <button
            className="button-secondary"
            disabled={cancelling}
            onClick={onCancel}
            type="button"
          >
            {cancelling ? 'Cancelling…' : 'Cancel relocation'}
          </button>
        ) : null}
        <Link className="button-secondary" href="/customer/support">
          Contact support
        </Link>
        {onStartNew ? (
          <button className="button-primary" onClick={onStartNew} type="button">
            Move again
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Notice({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="rounded-xl border border-success-border bg-success-subtle p-6 text-success-foreground">
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
function Detail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
function AddressDetails({ address }: Readonly<{ address: AddressSuggestion }>) {
  const unit = address.unit?.trim();
  const premise = [
    unit ? (/^unit\b/i.test(unit) ? unit : `Unit ${unit}`) : null,
    address.houseNumber,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <dl className="mt-3 grid gap-3 rounded-lg border border-border bg-muted p-4 text-sm sm:grid-cols-2">
      <Detail label="Unit / house number" value={premise || 'Not supplied'} />
      <Detail label="Street" value={address.street ?? 'Not supplied'} />
      <Detail label="Suburb" value={address.suburb ?? 'Not supplied'} />
      <Detail
        label="State and postcode"
        value={[address.stateCode ?? address.state, address.postcode].filter(Boolean).join(' ')}
      />
    </dl>
  );
}
function MutationError({ error }: Readonly<{ error: unknown }>) {
  return error ? (
    <p
      className="mt-4 rounded-lg bg-destructive-subtle p-4 text-sm text-destructive-foreground"
      role="alert"
    >
      {error instanceof ApiError ? error.message : 'The request could not be completed.'}
    </p>
  ) : null;
}
function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center text-muted-foreground">{message}</main>
  );
}
function formatAddress(address: ServiceAddress | null) {
  return address
    ? [address.addressLine2, address.addressLine1, address.suburb, address.state, address.postcode]
        .filter(Boolean)
        .join(', ')
    : 'Current service address';
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Adelaide',
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}
function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
function friendly(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
