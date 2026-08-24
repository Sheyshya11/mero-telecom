'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, apiRequest } from '../../lib/api/client';

const schema = z.object({ postcode: z.string().regex(/^\d{4}$/, 'Enter a four-digit postcode.') });
type Values = z.infer<typeof schema>;
type CoverageResult = {
  postcode: string;
  status: 'AVAILABLE' | 'PLANNED' | 'UNAVAILABLE';
  message: string;
  qualificationRequired: boolean;
  plans: Array<{ id: string; name: string; downloadMbps: number; uploadMbps: number; monthlyCents: number }>;
};

export default function CoveragePage() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { postcode: '' } });
  const lookup = useMutation({
    mutationFn: ({ postcode }: Values) => apiRequest<CoverageResult>(`/coverage?postcode=${encodeURIComponent(postcode)}`),
  });
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <Link className="text-sm font-semibold tracking-wide text-sky-700" href="/">MERO TELECOM</Link>
      <section className="mt-8 rounded-2xl bg-sky-950 px-6 py-10 text-white sm:px-10">
        <p className="text-sm font-semibold tracking-wide text-sky-200">SERVICE COVERAGE</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Check your postcode</h1>
        <p className="mt-3 max-w-2xl text-sky-100">See whether Mero Telecom is currently available in your area. A positive result still requires final address qualification.</p>
        <form className="mt-7 flex max-w-lg flex-col gap-3 sm:flex-row" onSubmit={form.handleSubmit((values) => lookup.mutate(values))}>
          <div className="flex-1"><input aria-label="Postcode" className="field" inputMode="numeric" maxLength={4} placeholder="e.g. 2000" {...form.register('postcode')} />{form.formState.errors.postcode ? <p className="mt-2 text-sm text-rose-200">{form.formState.errors.postcode.message}</p> : null}</div>
          <button className="button-primary h-11 bg-white text-sky-900 hover:bg-sky-50" disabled={lookup.isPending} type="submit">{lookup.isPending ? 'Checking…' : 'Check coverage'}</button>
        </form>
      </section>
      {lookup.error ? <p className="mt-6 rounded-lg bg-rose-50 p-4 text-rose-800" role="alert">{lookup.error instanceof ApiError ? lookup.error.message : 'Coverage could not be checked.'}</p> : null}
      {lookup.data ? <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-live="polite"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-slate-500">Postcode {lookup.data.postcode}</p><h2 className="mt-1 text-2xl font-bold">{lookup.data.status === 'AVAILABLE' ? 'Service available' : lookup.data.status === 'PLANNED' ? 'Expansion planned' : 'Not currently available'}</h2><p className="mt-2 text-slate-600">{lookup.data.message}</p></div><span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-semibold text-sky-800">{lookup.data.status}</span></div>{lookup.data.plans.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{lookup.data.plans.map((plan) => <article className="rounded-lg border border-slate-200 p-4" key={plan.id}><h3 className="font-semibold">{plan.name}</h3><p className="mt-2 text-sm text-slate-600">{plan.downloadMbps}/{plan.uploadMbps} Mbps</p><p className="mt-3 text-xl font-bold">${(plan.monthlyCents / 100).toFixed(2)}<span className="text-sm font-normal text-slate-500">/month</span></p></article>)}</div> : null}</section> : null}
    </main>
  );
}
