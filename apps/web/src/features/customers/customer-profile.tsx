'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import type { Customer } from './customer.types';

const profileSchema = z.object({
  phone: z.string().regex(/^(?:\+61|0)4\d{8}$/, 'Enter an Australian mobile number.'),
  addressLine1: z.string().min(1, 'Address is required.').max(255),
  addressLine2: z.string().max(255),
  suburb: z.string().min(1, 'Suburb is required.').max(100),
  state: z.string().min(2).max(3),
  postcode: z.string().regex(/^\d{4}$/, 'Enter a four-digit postcode.'),
});

type ProfileValues = z.infer<typeof profileSchema>;

export function CustomerProfile() {
  const { accessToken, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['customer-profile'],
    queryFn: () => apiRequest<Customer>('/customers/me', {}, accessToken),
    enabled: Boolean(accessToken && user?.role === 'CUSTOMER'),
  });
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      phone: '',
      addressLine1: '',
      addressLine2: '',
      suburb: '',
      state: 'NSW',
      postcode: '',
    },
  });

  useEffect(() => {
    if (!profile.data) return;
    form.reset({
      phone: profile.data.phone,
      addressLine1: profile.data.addressLine1,
      addressLine2: profile.data.addressLine2 ?? '',
      suburb: profile.data.suburb,
      state: profile.data.state,
      postcode: profile.data.postcode,
    });
  }, [form, profile.data]);

  const update = useMutation({
    mutationFn: (values: ProfileValues) =>
      apiRequest<Customer>(
        '/customers/me',
        {
          method: 'PATCH',
          body: JSON.stringify({ ...values, addressLine2: values.addressLine2.trim() || null }),
        },
        accessToken,
      ),
    onSuccess: async (customer) => {
      queryClient.setQueryData(['customer-profile'], customer);
      await queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] });
    },
  });

  if (isLoading) return <Status message="Restoring your session…" />;
  if (!user || user.role !== 'CUSTOMER') return <Status message="Customer access is required." />;
  if (profile.isPending) return <Status message="Loading your profile…" />;
  if (profile.isError || !profile.data)
    return <Status message="Unable to load your profile." onRetry={() => void profile.refetch()} />;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">My profile</h1>
          <p className="mt-2 text-slate-600">Keep your contact and service address current.</p>
        </div>
        <Link className="button-secondary" href="/customer/dashboard">
          Back to dashboard
        </Link>
      </header>
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 border-b border-slate-100 pb-5 sm:grid-cols-3">
          <Summary label="Account" value={profile.data.customerNumber} />
          <Summary label="Name" value={`${profile.data.firstName} ${profile.data.lastName}`} />
          <Summary label="Email" value={profile.data.email} />
        </div>
        <form
          className="mt-6 grid gap-4"
          onSubmit={form.handleSubmit((values) => update.mutate(values))}
        >
          <Field label="Mobile" error={form.formState.errors.phone?.message}>
            <input className="field" {...form.register('phone')} />
          </Field>
          <Field label="Address" error={form.formState.errors.addressLine1?.message}>
            <input className="field" {...form.register('addressLine1')} />
          </Field>
          <Field label="Address line 2" error={form.formState.errors.addressLine2?.message}>
            <input className="field" {...form.register('addressLine2')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Suburb" error={form.formState.errors.suburb?.message}>
              <input className="field" {...form.register('suburb')} />
            </Field>
            <Field label="State" error={form.formState.errors.state?.message}>
              <input className="field" {...form.register('state')} />
            </Field>
            <Field label="Postcode" error={form.formState.errors.postcode?.message}>
              <input className="field" inputMode="numeric" {...form.register('postcode')} />
            </Field>
          </div>
          {update.isSuccess ? (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
              Profile updated successfully.
            </p>
          ) : null}
          {update.error ? (
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {update.error instanceof ApiError
                ? update.error.message
                : 'Unable to update your profile.'}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button
              className="button-primary"
              disabled={update.isPending || !form.formState.isDirty}
              type="submit"
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
    </main>
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
function Summary({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}
function Status({ message, onRetry }: Readonly<{ message: string; onRetry?: () => void }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-slate-600">
      <div>
        <p>{message}</p>
        {onRetry ? (
          <button className="button-secondary mt-4" onClick={onRetry} type="button">
            Retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
