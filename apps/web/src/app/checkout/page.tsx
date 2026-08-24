'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm, type UseFormRegisterReturn, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import { useAuth } from '../../features/auth/auth-provider';
import { PlanCheckoutButton } from '../../features/payments/stripe-checkout-button';
import { ApiError, apiRequest } from '../../lib/api/client';

const addressSchema = z.object({
  addressLine1: z.string().min(1, 'Address is required.').max(255),
  addressLine2: z.string().max(255).optional(),
  suburb: z.string().min(1, 'Suburb is required.').max(100),
  state: z.string().min(2).max(3),
  postcode: z.string().regex(/^\d{4}$/, 'Enter a four-digit postcode.'),
});

const checkoutSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required.').max(100),
    lastName: z.string().min(1, 'Last name is required.').max(100),
    email: z.email('Enter a valid email address.').max(320),
    phone: z.string().regex(/^(?:\+61|0)4\d{8}$/, 'Enter an Australian mobile number.'),
    residentialAddress: addressSchema,
    serviceSameAsResidential: z.boolean(),
    serviceAddress: addressSchema.optional(),
    billingSameAsResidential: z.boolean(),
    billingAddress: addressSchema.optional(),
    termsAccepted: z.boolean().refine(Boolean, 'Accept the terms to continue.'),
    privacyAccepted: z.boolean().refine(Boolean, 'Accept the privacy policy to continue.'),
  })
  .superRefine((values, context) => {
    for (const [same, address, path] of [
      [values.serviceSameAsResidential, values.serviceAddress, 'serviceAddress'],
      [values.billingSameAsResidential, values.billingAddress, 'billingAddress'],
    ] as const) {
      if (same) continue;
      const result = addressSchema.safeParse(address);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: [path, ...issue.path] });
        }
      }
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

const emptyAddress = {
  addressLine1: '',
  addressLine2: '',
  suburb: '',
  state: 'NSW',
  postcode: '',
};

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
  const [existingAccount, setExistingAccount] = useState(false);
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      residentialAddress: emptyAddress,
      serviceSameAsResidential: true,
      serviceAddress: undefined,
      billingSameAsResidential: true,
      billingAddress: undefined,
      termsAccepted: false,
      privacyAccepted: false,
    },
  });
  const serviceSame = form.watch('serviceSameAsResidential');
  const billingSame = form.watch('billingSameAsResidential');
  const plans = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<PublicPlan[]>('/plans/public'),
  });
  const plan = plans.data?.find((candidate) => candidate.id === planId);
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
          residentialAddress: values.residentialAddress,
          serviceAddress: values.serviceSameAsResidential
            ? values.residentialAddress
            : (values.serviceAddress ?? values.residentialAddress),
          billingAddress: values.billingSameAsResidential
            ? values.residentialAddress
            : (values.billingAddress ?? values.residentialAddress),
          termsAccepted: values.termsAccepted,
          privacyAccepted: values.privacyAccepted,
        }),
      }),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
    onError: (error) => {
      setExistingAccount(error instanceof ApiError && error.statusCode === 409);
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
            Your existing customer profile will own this subscription. Stripe will confirm the
            authoritative amount shown below.
          </p>
          <PlanCheckoutButton planId={plan.id} />
        </section>
      </main>
    );
  }

  if (user) {
    return <Status message="Sign out of the staff account and continue with a customer account." />;
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
      <form
        className="mt-8 grid gap-8"
        onSubmit={form.handleSubmit((values) => checkout.mutate(values))}
      >
        <FormSection title="Your details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={form.formState.errors.firstName?.message}>
              <input autoComplete="given-name" className="field" {...form.register('firstName')} />
            </Field>
            <Field label="Last name" error={form.formState.errors.lastName?.message}>
              <input autoComplete="family-name" className="field" {...form.register('lastName')} />
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
          <AddressFields form={form} name="residentialAddress" />
        </FormSection>

        <FormSection title="Service address">
          <Checkbox
            label="Service address is the same as residential address"
            registration={form.register('serviceSameAsResidential')}
          />
          {!serviceSame ? <AddressFields form={form} name="serviceAddress" /> : null}
        </FormSection>

        <FormSection title="Billing address">
          <Checkbox
            label="Billing address is the same as residential address"
            registration={form.register('billingSameAsResidential')}
          />
          {!billingSame ? <AddressFields form={form} name="billingAddress" /> : null}
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

function AddressFields({
  form,
  name,
}: Readonly<{
  form: UseFormReturn<CheckoutValues>;
  name: 'residentialAddress' | 'serviceAddress' | 'billingAddress';
}>) {
  const errors = form.formState.errors[name];
  return (
    <div className="grid gap-4">
      <Field label="Address line 1" error={errors?.addressLine1?.message}>
        <input
          autoComplete="address-line1"
          className="field"
          {...form.register(`${name}.addressLine1`)}
        />
      </Field>
      <Field label="Address line 2" error={errors?.addressLine2?.message}>
        <input
          autoComplete="address-line2"
          className="field"
          {...form.register(`${name}.addressLine2`)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Suburb" error={errors?.suburb?.message}>
          <input className="field" {...form.register(`${name}.suburb`)} />
        </Field>
        <Field label="State" error={errors?.state?.message}>
          <input className="field" {...form.register(`${name}.state`)} />
        </Field>
        <Field label="Postcode" error={errors?.postcode?.message}>
          <input className="field" inputMode="numeric" {...form.register(`${name}.postcode`)} />
        </Field>
      </div>
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
  registration,
}: Readonly<{
  label: React.ReactNode;
  error?: string;
  registration: UseFormRegisterReturn;
}>) {
  return (
    <label className="flex items-start gap-3 text-sm text-slate-700">
      <input className="mt-1 size-4" type="checkbox" {...registration} />
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
