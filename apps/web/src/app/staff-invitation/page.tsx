'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .regex(/[a-z]/, 'Include a lowercase letter.')
      .regex(/[A-Z]/, 'Include an uppercase letter.')
      .regex(/\d/, 'Include a number.')
      .regex(/[^A-Za-z0-9]/, 'Include a symbol.'),
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
type Values = z.infer<typeof schema>;

export default function StaffInvitationPage() {
  return (
    <Suspense fallback={<Status message="Checking your invitation…" />}>
      <Content />
    </Suspense>
  );
}

function Content() {
  const token = useSearchParams().get('token') ?? '';
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const verification = useQuery({
    queryKey: ['staff-invitation', token],
    queryFn: () =>
      apiRequest<{ valid: boolean; role?: string; displayName?: string }>(
        '/auth/staff-invitations/verify',
        { method: 'POST', body: JSON.stringify({ token }) },
      ),
    enabled: token.length >= 32,
    retry: false,
  });
  const acceptance = useMutation({
    mutationFn: (values: Values) =>
      apiRequest<void>('/auth/staff-invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password: values.password }),
      }),
  });

  if (!token || verification.isError || verification.data?.valid === false) {
    return <Unavailable />;
  }
  if (verification.isPending) return <Status message="Checking your invitation…" />;
  if (acceptance.isSuccess) {
    return (
      <main className="mx-auto min-h-screen max-w-xl px-6 py-16 text-center">
        <h1 className="text-3xl font-bold text-slate-950">Invitation accepted</h1>
        <p className="mt-3 text-slate-600">
          Your email is verified and your account is active. You can now sign in.
        </p>
        <Link className="button-primary mt-6 inline-flex" href="/login">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-sky-700">MERO TELECOM</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-950">Accept your invitation</h1>
        <p className="mt-2 text-sm text-slate-600">
          {verification.data?.displayName ? `Welcome, ${verification.data.displayName}. ` : ''}
          Create a password for your {verification.data?.role?.toLowerCase()} account.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={form.handleSubmit((values) => acceptance.mutate(values))}
        >
          <Password
            label="Password"
            error={form.formState.errors.password?.message}
            registration={form.register('password')}
          />
          <Password
            label="Confirm password"
            error={form.formState.errors.confirmPassword?.message}
            registration={form.register('confirmPassword')}
          />
          {acceptance.isError ? (
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
              {acceptance.error instanceof ApiError
                ? acceptance.error.message
                : 'The invitation could not be accepted.'}
            </p>
          ) : null}
          <button className="button-primary" disabled={acceptance.isPending} type="submit">
            {acceptance.isPending ? 'Activating…' : 'Activate account'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Password({
  label,
  error,
  registration,
}: Readonly<{
  label: string;
  error?: string;
  registration: ReturnType<ReturnType<typeof useForm<Values>>['register']>;
}>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <input className="field" type="password" autoComplete="new-password" {...registration} />
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </label>
  );
}
function Unavailable() {
  return (
    <main className="mx-auto min-h-screen max-w-xl px-6 py-16 text-center">
      <h1 className="text-3xl font-bold text-slate-950">Invitation unavailable</h1>
      <p className="mt-3 text-slate-600">
        This invitation is invalid, expired, revoked, or has already been used. Ask an administrator
        to send a new invitation.
      </p>
      <Link className="button-primary mt-6 inline-flex" href="/login">
        Return to sign in
      </Link>
    </main>
  );
}
function Status({ message }: Readonly<{ message: string }>) {
  return <main className="grid min-h-screen place-items-center text-slate-600">{message}</main>;
}
