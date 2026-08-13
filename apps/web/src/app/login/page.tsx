'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '../../lib/api/client';
import { useAuth } from '../../features/auth/auth-provider';

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least eight characters.'),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: 'admin@merotelecom.test', password: 'ChangeMe123!' },
  });

  async function submit(values: LoginValues) {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      router.push(
        user.role === 'CUSTOMER'
          ? '/customer/dashboard'
          : user.role === 'STAFF'
            ? '/admin/subscriptions'
            : '/admin/dashboard',
      );
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to sign in.');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <Link className="text-sm font-semibold tracking-wide text-sky-700" href="/">
          MERO TELECOM
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Use a seeded development account to continue.</p>
        <form className="mt-6 grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input
              className="field"
              type="email"
              autoComplete="email"
              {...form.register('email')}
            />
            {form.formState.errors.email?.message ? (
              <span className="text-xs text-rose-700">{form.formState.errors.email.message}</span>
            ) : null}
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Password
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
            {form.formState.errors.password?.message ? (
              <span className="text-xs text-rose-700">
                {form.formState.errors.password.message}
              </span>
            ) : null}
          </label>
          {error ? (
            <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>
          ) : null}
          <button
            className="button-primary mt-2"
            disabled={form.formState.isSubmitting}
            type="submit"
          >
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
