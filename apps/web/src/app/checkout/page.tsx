'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';

import { useAuth } from '../../features/auth/auth-provider';
import { AddressAutocomplete } from '../../features/coverage/address-autocomplete';
import type {
  AddressSuggestion,
  CoverageResult,
  PublicCheckoutContext,
} from '../../features/coverage/coverage.types';
import { ApiError, apiRequest } from '../../lib/api/client';

const checkoutSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required.').max(100),
    lastName: z.string().min(1, 'Last name is required.').max(100),
    email: z.email('Enter a valid email address.').max(320),
    phone: z.string().regex(/^(?:\+61|0)4\d{8}$/, 'Enter an Australian mobile number.'),
    residentialSameAsService: z.boolean(),
    residentialAddressToken: z.string().optional(),
    billingSameAsResidential: z.boolean(),
    billingAddressToken: z.string().optional(),
    termsAccepted: z.boolean().refine(Boolean, 'Accept the terms to continue.'),
    privacyAccepted: z.boolean().refine(Boolean, 'Accept the privacy policy to continue.'),
  })
  .superRefine((values, context) => {
    if (
      !values.residentialSameAsService &&
      !/^[A-Za-z0-9_-]{43}$/.test(values.residentialAddressToken ?? '')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Select a residential address from the suggestions.',
        path: ['residentialAddressToken'],
      });
    }
    if (
      !values.billingSameAsResidential &&
      !/^[A-Za-z0-9_-]{43}$/.test(values.billingAddressToken ?? '')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Select a billing address from the suggestions.',
        path: ['billingAddressToken'],
      });
    }
  });

type CheckoutValues = z.infer<typeof checkoutSchema>;

interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Status message="Preparing checkout…" />}>
      <CheckoutContent />
    </Suspense>
  );
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const planId = searchParams.get('planId') ?? '';
  const { isLoading: authLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [existingAccount, setExistingAccount] = useState(false);
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      residentialSameAsService: true,
      residentialAddressToken: undefined,
      billingSameAsResidential: true,
      billingAddressToken: undefined,
      termsAccepted: false,
      privacyAccepted: false,
    },
  });
  const residentialSame = form.watch('residentialSameAsService');
  const billingSame = form.watch('billingSameAsResidential');
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<PublicPlan[]>('/plans/public'),
  });
  const plan = plans.data?.find((candidate) => candidate.id === planId);
  const checkoutContext = useQuery({
    queryKey: ['public-checkout-context'],
    queryFn: async () => {
      try {
        return await apiRequest<PublicCheckoutContext>('/payments/public-checkout-context');
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 410) return null;
        throw error;
      }
    },
    retry: false,
  });
  const matchingContext = checkoutContext.data?.planId === planId ? checkoutContext.data : null;
  const checkout = useMutation({
    mutationFn: (values: CheckoutValues) =>
      apiRequest<{ checkoutUrl: string }>('/payments/public-plan-checkout-session', {
        method: 'POST',
        body: JSON.stringify({
          planId,
          firstName: values.firstName,
          lastName: values.lastName,
          email: values.email,
          phone: values.phone,
          residentialSameAsService: values.residentialSameAsService,
          residentialAddressToken: values.residentialSameAsService
            ? undefined
            : values.residentialAddressToken,
          billingSameAsResidential: values.billingSameAsResidential,
          billingAddressToken: values.billingSameAsResidential
            ? undefined
            : values.billingAddressToken,
          termsAccepted: values.termsAccepted,
          privacyAccepted: values.privacyAccepted,
        }),
      }),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
    onError: (error) => {
      setExistingAccount(error instanceof ApiError && error.statusCode === 409);
      if (error instanceof ApiError && error.statusCode === 410) void checkoutContext.refetch();
    },
  });

  if (plans.isPending || authLoading) return <Status message="Preparing checkout…" />;
  if (plans.isError) return <Status message="Plans could not be loaded. Please try again." />;
  if (!plan) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold">Plan unavailable</h1>
        <p className="mt-3 text-slate-600">Choose an available plan before starting checkout.</p>
        <Link className="button-primary mt-6 inline-flex" href="/plans">
          View plans
        </Link>
      </main>
    );
  }

  if (user?.role === 'CUSTOMER') {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
        <CheckoutHeader />
        <PlanSummary plan={plan} />
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">Signed in as {user.email}</h2>
          <p className="mt-2 text-slate-600">
            Continue to My subscription to use this selection. If you already have a plan, you can
            review its prorated upgrade charge or schedule a downgrade. If you do not have a current
            plan, you can purchase this plan there.
          </p>
          <Link
            className="button-primary mt-5 inline-flex"
            href={`/customer/subscription?planId=${encodeURIComponent(plan.id)}`}
          >
            Continue with this plan
          </Link>
        </section>
      </main>
    );
  }

  if (user) {
    return <Status message="Sign out of the staff account and continue with a customer account." />;
  }

  if (checkoutContext.isPending) return <Status message="Restoring service qualification…" />;
  if (checkoutContext.isError) {
    return <Status message="Checkout verification is temporarily unavailable. Please retry." />;
  }

  const loginReturnTo = `/checkout?planId=${encodeURIComponent(plan.id)}`;
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <CheckoutHeader />
      <PlanSummary plan={plan} />
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm text-sky-950">Already a Mero Telecom customer?</p>
        <Link
          className="button-secondary"
          href={`/login?returnTo=${encodeURIComponent(loginReturnTo)}`}
        >
          Sign in and continue
        </Link>
      </div>
      <ServiceAddressSection
        context={matchingContext}
        onContextChange={(context) =>
          queryClient.setQueryData(['public-checkout-context'], context)
        }
        plan={plan}
      />
      {!matchingContext ? null : (
        <form
          className="mt-8 grid gap-8"
          onSubmit={form.handleSubmit((values) => checkout.mutate(values))}
        >
          <FormSection title="Your details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" error={form.formState.errors.firstName?.message}>
                <input
                  autoComplete="given-name"
                  className="field"
                  {...form.register('firstName')}
                />
              </Field>
              <Field label="Last name" error={form.formState.errors.lastName?.message}>
                <input
                  autoComplete="family-name"
                  className="field"
                  {...form.register('lastName')}
                />
              </Field>
              <Field label="Email" error={form.formState.errors.email?.message}>
                <input
                  autoComplete="email"
                  className="field"
                  type="email"
                  {...form.register('email')}
                />
              </Field>
              <Field label="Mobile" error={form.formState.errors.phone?.message}>
                <input
                  autoComplete="tel"
                  className="field"
                  placeholder="0400000000"
                  {...form.register('phone')}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Residential address">
            <Checkbox
              label="Residential address is the same as the confirmed service address"
              onCheckedChange={(checked) => {
                if (checked) {
                  form.setValue('residentialAddressToken', undefined, {
                    shouldValidate: true,
                  });
                }
              }}
              registration={form.register('residentialSameAsService')}
            />
            {!residentialSame ? (
              <CheckoutAddressSelection
                error={form.formState.errors.residentialAddressToken?.message}
                label="Residential street address"
                onSelectionChange={(selection) =>
                  form.setValue('residentialAddressToken', selection?.selectionToken, {
                    shouldValidate: true,
                  })
                }
              />
            ) : null}
          </FormSection>

          <FormSection title="Billing address">
            <Checkbox
              label="Billing address is the same as residential address"
              onCheckedChange={(checked) => {
                if (checked) {
                  form.setValue('billingAddressToken', undefined, {
                    shouldValidate: true,
                  });
                }
              }}
              registration={form.register('billingSameAsResidential')}
            />
            {!billingSame ? (
              <CheckoutAddressSelection
                error={form.formState.errors.billingAddressToken?.message}
                label="Billing street address"
                onSelectionChange={(selection) =>
                  form.setValue('billingAddressToken', selection?.selectionToken, {
                    shouldValidate: true,
                  })
                }
              />
            ) : null}
          </FormSection>

          <FormSection title="Review and consent">
            <p className="text-sm text-slate-600">
              Amount due now: <strong>${(plan.monthlyCents / 100).toFixed(2)} AUD</strong>, GST
              included. The backend will reload the plan and price before creating Checkout.
            </p>
            <Checkbox
              error={form.formState.errors.termsAccepted?.message}
              label={
                <span>
                  I accept the{' '}
                  <Link className="text-sky-700 underline" href="/terms">
                    terms of service
                  </Link>
                  .
                </span>
              }
              registration={form.register('termsAccepted')}
            />
            <Checkbox
              error={form.formState.errors.privacyAccepted?.message}
              label={
                <span>
                  I accept the{' '}
                  <Link className="text-sky-700 underline" href="/privacy">
                    privacy policy
                  </Link>
                  .
                </span>
              }
              registration={form.register('privacyAccepted')}
            />
            {existingAccount ? (
              <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">
                This email already has an account.{' '}
                <Link
                  className="font-semibold underline"
                  href={`/login?returnTo=${encodeURIComponent(loginReturnTo)}`}
                >
                  Sign in and continue with this plan.
                </Link>
              </div>
            ) : checkout.isError ? (
              <p className="rounded-md bg-rose-50 p-4 text-sm text-rose-800">
                {checkout.error instanceof ApiError
                  ? checkout.error.message
                  : 'Checkout could not be started.'}
              </p>
            ) : null}
            <button className="button-primary" disabled={checkout.isPending} type="submit">
              {checkout.isPending ? 'Opening secure payment…' : 'Continue to secure payment'}
            </button>
          </FormSection>
        </form>
      )}
    </main>
  );
}

function CheckoutHeader() {
  return (
    <header className="border-b border-slate-200 pb-6">
      <Link className="text-sm font-semibold tracking-wide text-sky-700" href="/">
        MERO TELECOM
      </Link>
      <h1 className="mt-2 text-3xl font-bold">Internet plan checkout</h1>
      <p className="mt-2 text-slate-600">
        Your account is activated securely after verified payment.
      </p>
    </header>
  );
}

function PlanSummary({ plan }: Readonly<{ plan: PublicPlan }>) {
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold tracking-wide text-sky-700">SELECTED PLAN</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{plan.name}</h2>
          <p className="mt-1 text-slate-600">
            {plan.downloadMbps}/{plan.uploadMbps} Mbps
          </p>
        </div>
        <p className="text-2xl font-bold">
          ${(plan.monthlyCents / 100).toFixed(2)}
          <span className="text-sm font-normal text-slate-500">/month</span>
        </p>
      </div>
    </section>
  );
}

function FormSection({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function ServiceAddressSection({
  context,
  onContextChange,
  plan,
}: Readonly<{
  context: PublicCheckoutContext | null;
  onContextChange: (context: PublicCheckoutContext | null) => void;
  plan: PublicPlan;
}>) {
  const [selection, setSelection] = useState<AddressSuggestion | null>(null);
  const [coverageResult, setCoverageResult] = useState<CoverageResult | null>(null);
  const prepare = useMutation({
    mutationFn: async (selectionToken: string) => {
      const coverage = await apiRequest<CoverageResult>('/coverage/check', {
        method: 'POST',
        body: JSON.stringify({ selectionToken }),
      });
      if (
        coverage.status !== 'AVAILABLE' ||
        !coverage.qualificationToken ||
        !coverage.plans.some((candidate) => candidate.id === plan.id)
      ) {
        return { coverage, context: null };
      }
      const checkoutContext = await apiRequest<PublicCheckoutContext>(
        '/payments/public-checkout-context',
        {
          method: 'POST',
          body: JSON.stringify({
            planId: plan.id,
            qualificationToken: coverage.qualificationToken,
          }),
        },
      );
      return { coverage, context: checkoutContext };
    },
    onSuccess: ({ coverage, context: preparedContext }) => {
      setCoverageResult(coverage);
      if (preparedContext) onContextChange(preparedContext);
    },
  });
  const clear = useMutation({
    mutationFn: () =>
      apiRequest<void>('/payments/public-checkout-context/clear', { method: 'POST' }),
    onSuccess: () => {
      setSelection(null);
      setCoverageResult(null);
      onContextChange(null);
    },
  });

  if (context) {
    return (
      <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-wide text-emerald-800">
              CONFIRMED SERVICE ADDRESS
            </p>
            <h2 className="mt-2 text-xl font-bold text-emerald-950">
              {context.serviceAddress.formattedAddress}
            </h2>
            <p className="mt-2 text-sm text-emerald-900">
              Estimated {context.qualification.technology} service up to{' '}
              {context.qualification.maximumSpeedMbps} Mbps. This is a database estimate, not
              official nbn confirmation.
            </p>
          </div>
          <button
            className="button-secondary"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
            type="button"
          >
            {clear.isPending ? 'Clearing…' : 'Change service address'}
          </button>
        </div>
        {clear.isError ? (
          <p className="mt-4 text-sm text-rose-800" role="alert">
            {clear.error instanceof ApiError
              ? clear.error.message
              : 'The service address could not be changed.'}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-4 rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
      <div>
        <p className="text-sm font-semibold tracking-wide text-amber-800">
          SERVICE ADDRESS REQUIRED
        </p>
        <h2 className="mt-2 text-xl font-bold text-amber-950">
          Confirm where internet is required
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          Select the installation address. It may be different from where the account holder lives.
        </p>
      </div>
      <AddressAutocomplete
        label="Service street address"
        onSelectionChange={(nextSelection) => {
          setSelection(nextSelection);
          setCoverageResult(null);
          prepare.reset();
        }}
        placeholder="Start typing the installation address"
        selectedMessage="Service address selected. Ready to verify."
      />
      <button
        className="button-primary w-fit"
        disabled={!selection || prepare.isPending}
        onClick={() => selection && prepare.mutate(selection.selectionToken)}
        type="button"
      >
        {prepare.isPending ? 'Checking service and plan…' : 'Confirm service availability'}
      </button>
      {coverageResult && !prepare.data?.context ? (
        <p className="rounded-lg bg-white/80 p-4 text-sm text-amber-950" role="status">
          {coverageResult.plans.some((candidate) => candidate.id === plan.id)
            ? coverageResult.message
            : `${coverageResult.message} The selected plan is not compatible with this address.`}
        </p>
      ) : null}
      {prepare.isError ? (
        <p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {prepare.error instanceof ApiError
            ? prepare.error.message
            : 'Service availability could not be confirmed.'}
        </p>
      ) : null}
    </section>
  );
}

function CheckoutAddressSelection({
  error,
  label,
  onSelectionChange,
}: Readonly<{
  error?: string;
  label: string;
  onSelectionChange: (selection: AddressSuggestion | null) => void;
}>) {
  return (
    <div>
      <AddressAutocomplete
        label={label}
        onSelectionChange={onSelectionChange}
        selectedMessage="Address selected."
      />
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: Readonly<{ label: string; error?: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
      {error ? <span className="text-xs font-normal text-rose-700">{error}</span> : null}
    </label>
  );
}

function Checkbox({
  label,
  error,
  onCheckedChange,
  registration,
}: Readonly<{
  label: React.ReactNode;
  error?: string;
  onCheckedChange?: (checked: boolean) => void;
  registration: UseFormRegisterReturn;
}>) {
  const { onChange, ...registeredInput } = registration;
  return (
    <label className="flex items-start gap-3 text-sm text-slate-700">
      <input
        className="mt-1 size-4"
        type="checkbox"
        {...registeredInput}
        onChange={(event) => {
          void onChange(event);
          onCheckedChange?.(event.target.checked);
        }}
      />
      <span>
        {label}
        {error ? <span className="mt-1 block text-xs text-rose-700">{error}</span> : null}
      </span>
    </label>
  );
}

function Status({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      {message}
    </main>
  );
}
