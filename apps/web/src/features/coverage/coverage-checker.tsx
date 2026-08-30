'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError, apiRequest } from '../../lib/api/client';
import styles from '../../styles/landing.module.css';
import { getDashboardRoute } from '../auth/auth-navigation';
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

export function CoverageChecker({
  variant = 'default',
}: Readonly<{ variant?: 'default' | 'landing' }>) {
  const { isLoading, user } = useAuth();
  const router = useRouter();
  const isLanding = variant === 'landing';
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
    <section
      className={
        isLanding
          ? styles.coverageCard
          : 'rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8'
      }
    >
      <p
        className={
          isLanding ? styles.coverageEyebrow : 'text-sm font-semibold tracking-wide text-sky-700'
        }
      >
        ADDRESS COVERAGE
      </p>
      <h2
        className={
          isLanding ? styles.coverageTitle : 'mt-2 text-2xl font-bold tracking-tight text-slate-950'
        }
      >
        {isLanding ? "Check what's available at your address" : 'Check your service address'}
      </h2>
      <p className={isLanding ? styles.coverageCopy : 'mt-2 max-w-2xl text-slate-600'}>
        {isLanding
          ? 'Enter your address to see whether Mero Telecom is available in your area and discover the plans available to you.'
          : 'Mero Telecom currently services selected areas of South Australia.'}
      </p>

      <div className={isLanding ? styles.coverageControls : undefined}>
        <div className={isLanding ? undefined : 'relative mt-6 max-w-2xl'}>
          <AddressAutocomplete
            label="Australian street address"
            onSelectionChange={(suggestion) => {
              setSelected(suggestion);
              coverageCheck.reset();
              prepareCheckout.reset();
            }}
            placeholder="Start typing an address, e.g. 1 North Terrace, Adelaide"
            selectedMessage="Address selected. Ready to check."
            variant={variant}
          />
        </div>

        <button
          className={isLanding ? styles.primaryButton : 'button-primary mt-3'}
          disabled={!selected || coverageCheck.isPending}
          onClick={() => selected && coverageCheck.mutate(selected.selectionToken)}
          type="button"
        >
          {coverageCheck.isPending
            ? isLanding
              ? 'Checking your address…'
              : 'Checking coverage…'
            : isLanding
              ? 'Check Availability'
              : 'Check coverage'}
        </button>
      </div>

      {coverageCheck.isError ? (
        <p
          className={
            isLanding
              ? styles.coverageError
              : 'mt-5 rounded-lg bg-rose-50 p-4 text-sm text-rose-800'
          }
          role="alert"
        >
          {errorMessage(
            coverageCheck.error,
            'Coverage could not be checked. Select the address again.',
          )}
        </p>
      ) : null}

      {result ? (
        <div className={isLanding ? styles.coverageResult : 'mt-7'} aria-live="polite">
          <section
            className={`${isLanding ? styles.resultCard : 'rounded-xl border p-5'} ${resultStyles[result.status]}`}
          >
            <div
              className={
                isLanding ? styles.resultHeader : 'flex flex-wrap items-start justify-between gap-3'
              }
            >
              <div>
                <p className={isLanding ? styles.resultAddress : 'text-sm font-semibold'}>
                  {result.address.formattedAddress}
                </p>
                <h3 className={isLanding ? styles.resultTitle : 'mt-2 text-xl font-bold'}>
                  {resultTitles[result.status]}
                </h3>
              </div>
              <span
                className={
                  isLanding
                    ? styles.resultBadge
                    : 'rounded-full bg-white/70 px-3 py-1 text-xs font-bold'
                }
              >
                {result.status.replaceAll('_', ' ')}
              </span>
            </div>
            <p className={isLanding ? styles.resultMessage : 'mt-3 text-sm leading-6'}>
              {result.message}
            </p>
            {result.qualification.technology || result.qualification.maximumSpeedMbps ? (
              <dl
                className={
                  isLanding ? styles.qualificationGrid : 'mt-4 grid gap-3 text-sm sm:grid-cols-2'
                }
              >
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
            <div className={isLanding ? styles.compatiblePlans : 'mt-6'}>
              <h3 className={isLanding ? undefined : 'text-lg font-semibold text-slate-950'}>
                Compatible plans
              </h3>
              <div className={isLanding ? styles.compatibleGrid : 'mt-3 grid gap-4 md:grid-cols-3'}>
                {result.plans.map((plan) => (
                  <article
                    className={
                      isLanding ? styles.compatibleCard : 'rounded-xl border border-slate-200 p-5'
                    }
                    key={plan.id}
                  >
                    <h4 className="font-semibold text-slate-950">{plan.name}</h4>
                    <p className="mt-2 text-sm text-slate-600">
                      {plan.downloadMbps}/{plan.uploadMbps} Mbps
                    </p>
                    <p
                      className={
                        isLanding ? styles.compatiblePrice : 'mt-3 text-xl font-bold text-slate-950'
                      }
                    >
                      ${(plan.monthlyCents / 100).toFixed(2)}
                      <span className="text-sm font-normal text-slate-500">/month</span>
                    </p>
                    {isLoading ? (
                      <span
                        aria-label="Restoring session"
                        className={
                          isLanding
                            ? styles.primaryButton
                            : 'button-primary mt-4 inline-flex w-full justify-center'
                        }
                      >
                        Checking account…
                      </span>
                    ) : user?.role === 'CUSTOMER' ? (
                      <Link
                        className={
                          isLanding
                            ? styles.primaryButton
                            : 'button-primary mt-4 inline-flex w-full justify-center'
                        }
                        href={`/customer/subscription?planId=${encodeURIComponent(plan.id)}`}
                      >
                        Review this plan
                      </Link>
                    ) : user ? (
                      <Link
                        className={
                          isLanding
                            ? styles.primaryButton
                            : 'button-primary mt-4 inline-flex w-full justify-center'
                        }
                        href={getDashboardRoute(user.role)}
                      >
                        Go to Dashboard
                      </Link>
                    ) : (
                      <button
                        className={
                          isLanding
                            ? styles.primaryButton
                            : 'button-primary mt-4 inline-flex w-full justify-center'
                        }
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
                <p
                  className={
                    isLanding
                      ? styles.coverageError
                      : 'mt-4 rounded-lg bg-rose-50 p-4 text-sm text-rose-800'
                  }
                  role="alert"
                >
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
