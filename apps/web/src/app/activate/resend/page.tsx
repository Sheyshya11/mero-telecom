'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { apiRequest } from '../../../lib/api/client';

const schema = z.object({ email: z.email('Enter a valid email address.').max(320) });
type Values = z.infer<typeof schema>;

export default function ResendActivationPage() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const resend = useMutation({
    mutationFn: (values: Values) =>
      apiRequest<void>('/auth/activation/resend', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
  });

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        <Link className="text-sm font-semibold tracking-wide text-sky-700" href="/">
          MERO TELECOM
        </Link>
        <h1 className="mt-3 text-3xl font-bold">Resend activation email</h1>
        <p className="mt-2 text-sm text-slate-600">
          If an account is waiting for activation, we will send a new 24-hour link and invalidate
          the previous one.
        </p>
        {resend.isSuccess ? (
          <div className="mt-6 rounded-md bg-emerald-50 p-4 text-sm text-emerald-900">
            If the account is eligible, a new activation email has been sent.
          </div>
        ) : (
          <form
            className="mt-6 grid gap-4"
            onSubmit={form.handleSubmit((values) => resend.mutate(values))}
          >
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              Email
              <input
                autoComplete="email"
                className="field"
                type="email"
                {...form.register('email')}
              />
              {form.formState.errors.email?.message ? (
                <span className="text-xs text-rose-700">{form.formState.errors.email.message}</span>
              ) : null}
            </label>
            <button className="button-primary" disabled={resend.isPending} type="submit">
              {resend.isPending ? 'Sending…' : 'Send a new link'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
