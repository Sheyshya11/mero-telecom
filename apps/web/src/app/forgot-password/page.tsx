'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';
import { getHomeRoute } from '../../features/auth/auth-navigation';
import { useAuth } from '../../features/auth/auth-provider';

const acknowledgement =
  'If an account exists for that email address, a password reset link has been sent.';
const schema = z.object({ email: z.email('Enter a valid email address.') });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const { isLoading, user } = useAuth();
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isLoading && user) router.replace(getHomeRoute(user));
  }, [isLoading, router, user]);

  async function submit(values: Values): Promise<void> {
    form.clearErrors('root');
    try {
      await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSubmitted(true);
    } catch (reason) {
      form.setError('root', { message: forgotPasswordErrorMessage(reason) });
    }
  }

  if (isLoading || user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-600">
        Loading your account…
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6 py-12">
      <section
        aria-labelledby="forgot-password-heading"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9"
      >
        <Link className="text-sm font-bold tracking-wide text-sky-700" href="/">
          MERO TELECOM
        </Link>
        {submitted ? (
          <div className="mt-6" role="status">
            <h1 className="text-3xl font-bold text-slate-950">Check your email</h1>
            <p className="mt-3 text-slate-600">{acknowledgement}</p>
            <p className="mt-3 text-sm text-slate-500">
              The secure link expires in 30 minutes. Check your spam folder if it does not arrive.
            </p>
            <Link className="button-primary mt-7 inline-flex" href="/login">
              Return to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-3xl font-bold text-slate-950" id="forgot-password-heading">
              Forgot your password?
            </h1>
            <p className="mt-3 text-slate-600">
              Enter the email address for your Mero Telecom account and we will send reset
              instructions if it is eligible.
            </p>
            <form className="mt-7 grid gap-4" onSubmit={form.handleSubmit(submit)}>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                Email address
                <input
                  autoComplete="email"
                  autoFocus
                  className="field"
                  type="email"
                  {...form.register('email')}
                />
                {form.formState.errors.email?.message ? (
                  <span className="text-xs text-rose-700">
                    {form.formState.errors.email.message}
                  </span>
                ) : null}
              </label>
              {form.formState.errors.root?.message ? (
                <p aria-live="polite" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
                  {form.formState.errors.root.message}
                </p>
              ) : null}
              <button
                className="button-primary"
                disabled={form.formState.isSubmitting}
                type="submit"
              >
                {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <Link className="mt-6 inline-flex text-sm font-semibold text-sky-700" href="/login">
              Back to sign in
            </Link>
          </>
        )}
      </section>
    </main>
  );
}

export function forgotPasswordErrorMessage(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : 'Unable to request a reset right now.';
}
