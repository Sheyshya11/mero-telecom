'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';

import { MeroTelecomLogo } from '../../components/brand/mero-telecom-logo';
import { ApiError, apiRequest } from '../../lib/api/client';

const schema = z
  .object({
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use no more than 128 characters.')
      .regex(/[a-z]/, 'Include a lowercase letter.')
      .regex(/[A-Z]/, 'Include an uppercase letter.')
      .regex(/\d/, 'Include a number.')
      .regex(/[^A-Za-z0-9]/, 'Include a symbol.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });
type Values = z.infer<typeof schema>;
type LinkState = 'checking' | 'valid' | 'invalid';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetStatus message="Checking your reset link…" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [token] = useState(() => searchParams.get('token') ?? '');
  const [linkState, setLinkState] = useState<LinkState>('checking');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', '/reset-password');
    if (token.length < 32) {
      setLinkState('invalid');
      return;
    }
    let active = true;
    void apiRequest<{ valid: boolean }>('/auth/reset-password/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((result) => {
        if (active) setLinkState(result.valid ? 'valid' : 'invalid');
      })
      .catch(() => {
        if (active) setLinkState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(values: Values): Promise<void> {
    setServerError(null);
    try {
      await apiRequest<void>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: values.newPassword }),
      });
      router.replace('/reset-password/success');
    } catch (reason) {
      if (reason instanceof ApiError && reason.statusCode === 400) {
        setLinkState('invalid');
        return;
      }
      setServerError(
        reason instanceof ApiError ? reason.message : 'Unable to reset your password right now.',
      );
    }
  }

  if (linkState === 'checking') return <ResetStatus message="Checking your reset link…" />;
  if (linkState === 'invalid') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12 text-center">
        <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
            <MeroTelecomLogo alt="" preload size="auth" />
          </Link>
          <h1 className="mt-5 text-3xl font-bold">Reset link unavailable</h1>
          <p className="mt-3 text-slate-600">
            This password reset link is invalid, expired, or has already been used.
          </p>
          <Link className="button-primary mt-7 inline-flex" href="/forgot-password">
            Request a new link
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
          <MeroTelecomLogo alt="" preload size="auth" />
        </Link>
        <h1 className="mt-5 text-3xl font-bold">Create a new password</h1>
        <p className="mt-3 text-sm text-slate-600">
          Use at least 12 characters with uppercase, lowercase, a number and a symbol.
        </p>
        <form className="mt-7 grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <PasswordField
            error={form.formState.errors.newPassword?.message}
            label="New password"
            registration={form.register('newPassword')}
          />
          <PasswordField
            error={form.formState.errors.confirmPassword?.message}
            label="Confirm new password"
            registration={form.register('confirmPassword')}
          />
          {serverError ? (
            <p aria-live="polite" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              {serverError}
            </p>
          ) : null}
          <button className="button-primary" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? 'Updating…' : 'Reset password'}
          </button>
        </form>
      </section>
    </main>
  );
}

function PasswordField({
  label,
  error,
  registration,
}: Readonly<{
  label: string;
  error?: string;
  registration: UseFormRegisterReturn;
}>) {
  const [visible, setVisible] = useState(false);
  const inputId = registration.name;
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700" htmlFor={inputId}>
      {label}
      <span className="relative">
        <input
          autoComplete="new-password"
          className="field pr-20"
          id={inputId}
          type={visible ? 'text' : 'password'}
          {...registration}
        />
        <button
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-3 text-xs font-bold text-sky-700"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </label>
  );
}

function ResetStatus({ message }: Readonly<{ message: string }>) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 text-slate-600">
      <div className="grid justify-items-center gap-5 text-center">
        <MeroTelecomLogo preload size="auth" />
        <p role="status">{message}</p>
      </div>
    </main>
  );
}
