'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import type {
  AddressSuggestion,
  CoverageResult,
  CoverageResultStatus,
  PublicCheckoutContext,
} from './coverage.types';
import { AddressAutocomplete } from './address-autocomplete';

const resultTitles: Record<CoverageResultStatus, string> = {
  AVAILABLE: 'Service is estimated to be available',
  COMING_SOON: 'Mero Telecom is coming soon',
  NOT_AVAILABLE: 'Service is not currently available',
  OUTSIDE_OPERATING_REGION: 'Outside our current operating region',
  MANUAL_REVIEW: 'This address needs manual review',
};

const resultStyles: Record<CoverageResultStatus, string> = {
  AVAILABLE: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  COMING_SOON: 'border-sky-200 bg-sky-50 text-sky-900',
  NOT_AVAILABLE: 'border-slate-200 bg-slate-50 text-slate-900',
  OUTSIDE_OPERATING_REGION: 'border-amber-200 bg-amber-50 text-amber-950',
  MANUAL_REVIEW: 'border-violet-200 bg-violet-50 text-violet-950',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function CoverageChecker() {
  const { user } = useAuth();
  const router = useRouter();
  const [selected, setSelected] = useState<AddressSuggestion | null>(null);

  const coverageCheck = useMutation({
    mutationFn: (selectionToken: string) =>
      apiRequest<CoverageResult>('/coverage/check', {
        method: 'POST',
        body: JSON.stringify({ selectionToken }),
      }),
  });
  const prepareCheckout = useMutation({
    mutationFn: ({ planId, qualificationToken }: { planId: string; qualificationToken: string }) =>
      apiRequest<PublicCheckoutContext>('/payments/public-checkout-context', {
        method: 'POST',
        body: JSON.stringify({ planId, qualificationToken }),
      }),
    onSuccess: (context) => router.push(`/checkout?planId=${encodeURIComponent(context.planId)}`),
  });
  const result = coverageCheck.data;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold tracking-wide text-sky-700">ADDRESS COVERAGE</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
        Check your service address
      </h2>
      <p className="mt-2 max-w-2xl text-slate-600">
        Mero Telecom currently services selected areas of South Australia.
      </p>

      <div className="relative mt-6 max-w-2xl">
        <AddressAutocomplete
          label="Australian street address"
          onSelectionChange={(suggestion) => {
            setSelected(suggestion);
            coverageCheck.reset();
            prepareCheckout.reset();
          }}
          placeholder="Start typing an address, e.g. 1 North Terrace, Adelaide"
          selectedMessage="Address selected. Ready to check."
        />
      </div>

      <button
        className="button-primary mt-3"
        disabled={!selected || coverageCheck.isPending}
        onClick={() => selected && coverageCheck.mutate(selected.selectionToken)}
        type="button"
      >
        {coverageCheck.isPending ? 'Checking coverage…' : 'Check coverage'}
      </button>

      {coverageCheck.isError ? (
        <p className="mt-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          {errorMessage(
            coverageCheck.error,
            'Coverage could not be checked. Select the address again.',
          )}
        </p>
      ) : null}

      {result ? (
        <div className="mt-7" aria-live="polite">
          <section className={`rounded-xl border p-5 ${resultStyles[result.status]}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{result.address.formattedAddress}</p>
                <h3 className="mt-2 text-xl font-bold">{resultTitles[result.status]}</h3>
              </div>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold">
                {result.status.replaceAll('_', ' ')}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6">{result.message}</p>
            {result.qualification.technology || result.qualification.maximumSpeedMbps ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium opacity-70">Access technology</dt>
                  <dd className="mt-1 font-semibold">
                    {result.qualification.technology ?? 'Needs confirmation'}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium opacity-70">Estimated maximum speed</dt>
                  <dd className="mt-1 font-semibold">
                    {result.qualification.maximumSpeedMbps
                      ? `${result.qualification.maximumSpeedMbps} Mbps`
                      : 'Needs confirmation'}
                  </dd>
                </div>
              </dl>
            ) : null}
          </section>

          {result.status === 'AVAILABLE' && result.plans.length ? (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-slate-950">Compatible plans</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                {result.plans.map((plan) => (
                  <article className="rounded-xl border border-slate-200 p-5" key={plan.id}>
                    <h4 className="font-semibold text-slate-950">{plan.name}</h4>
                    <p className="mt-2 text-sm text-slate-600">
                      {plan.downloadMbps}/{plan.uploadMbps} Mbps
                    </p>
                    <p className="mt-3 text-xl font-bold text-slate-950">
                      ${(plan.monthlyCents / 100).toFixed(2)}
                      <span className="text-sm font-normal text-slate-500">/month</span>
                    </p>
                    {user?.role === 'CUSTOMER' ? (
                      <Link
                        className="button-primary mt-4 inline-flex w-full justify-center"
                        href={`/customer/subscription?planId=${encodeURIComponent(plan.id)}`}
                      >
                        Review this plan
                      </Link>
                    ) : (
                      <button
                        className="button-primary mt-4 inline-flex w-full justify-center"
                        disabled={!result.qualificationToken || prepareCheckout.isPending}
                        onClick={() =>
                          result.qualificationToken &&
                          prepareCheckout.mutate({
                            planId: plan.id,
                            qualificationToken: result.qualificationToken,
                          })
                        }
                        type="button"
                      >
                        {prepareCheckout.isPending ? 'Preparing checkout…' : 'Choose plan'}
                      </button>
                    )}
                  </article>
                ))}
              </div>
              {prepareCheckout.isError ? (
                <p className="mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800" role="alert">
                  {errorMessage(
                    prepareCheckout.error,
                    'Checkout could not be prepared. Check coverage again.',
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
