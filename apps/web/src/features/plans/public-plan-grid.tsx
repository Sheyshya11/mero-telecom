'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { LandingIcon } from '../../components/landing/landing-icons';
import { apiRequest } from '../../lib/api/client';
import styles from '../../styles/landing.module.css';
import { useAuth } from '../auth/auth-provider';

interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  highlights?: string[];
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

function formatMonthlyPrice(monthlyCents: number): string {
  const amount = monthlyCents / 100;
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getPlanHighlights(downloadMbps: number): string[] {
  if (downloadMbps <= 25) {
    return ['Web browsing and email', 'Social media', 'Light streaming'];
  }
  if (downloadMbps <= 50) {
    return ['Multiple devices at once', 'HD streaming', 'Working from home'];
  }
  if (downloadMbps <= 100) {
    return ['4K streaming', 'Online gaming', 'Larger households'];
  }
  if (downloadMbps <= 250) {
    return ['Heavy streaming', 'Fast game downloads', 'Power users and creators'];
  }
  return ['Maximum home performance', 'Many devices at once', 'Ultra-fast downloads'];
}

export function PublicPlanGrid({
  variant = 'default',
}: Readonly<{ variant?: 'default' | 'landing' }>) {
  const { user } = useAuth();
  const isLanding = variant === 'landing';
  const query = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => apiRequest<PublicPlan[]>('/plans/public'),
  });

  if (query.isPending) {
    if (isLanding) {
      return (
        <div aria-label="Loading plans" className={styles.plansGrid}>
          {Array.from({ length: 5 }, (_, index) => (
            <span className={styles.planSkeleton} key={index} />
          ))}
        </div>
      );
    }
    return <p className="mt-8 text-slate-500">Loading plans…</p>;
  }
  if (query.isError) {
    return (
      <div
        className={isLanding ? styles.plansErrorCard : 'mt-8 flex items-center gap-3 text-rose-700'}
      >
        {isLanding ? <LandingIcon name="activity" size={22} /> : null}
        <p>Plans could not be loaded.</p>
        <button
          className={isLanding ? styles.primaryButton : 'button-secondary'}
          onClick={() => void query.refetch()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }
  if (query.data.length === 0) {
    return (
      <p className={isLanding ? styles.plansEmptyCard : 'mt-8 text-slate-500'}>
        No plans are currently available.
      </p>
    );
  }

  return (
    <div className={isLanding ? styles.plansGrid : 'mt-8 grid gap-5 md:grid-cols-3'}>
      {query.data.map((plan) => {
        const isPopular = isLanding && plan.downloadMbps === 50;
        const highlights = plan.highlights?.length
          ? plan.highlights
          : getPlanHighlights(plan.downloadMbps);
        return (
          <article
            className={
              isLanding
                ? `${styles.planCard} ${isPopular ? styles.planCardPopular : ''}`
                : 'rounded-xl border border-slate-200 bg-white p-6 shadow-sm'
            }
            key={plan.id}
          >
            {isLanding ? <span className={styles.planAccent} aria-hidden="true" /> : null}
            {isPopular ? (
              <span className={styles.popularBadge}>
                <LandingIcon name="star" size={12} />
                Most popular
              </span>
            ) : null}
            {isLanding ? <p className={styles.planEyebrow}>NBN plan</p> : null}
            <h2 className={isLanding ? undefined : 'text-xl font-bold'}>{plan.name}</h2>
            <p className={isLanding ? styles.planDescription : 'mt-3 min-h-12 text-slate-600'}>
              {plan.description}
            </p>
            {isLanding ? (
              <>
                <p className={styles.planPrice}>
                  <span className={styles.planCurrency}>$</span>
                  <strong>{formatMonthlyPrice(plan.monthlyCents)}</strong>
                  <span className={styles.planPriceMeta}>
                    per month
                    <small>GST included</small>
                  </span>
                </p>
                <div aria-label={`${plan.name} speeds`} className={styles.planSpeeds}>
                  <div>
                    <span>
                      <LandingIcon name="wifi" size={15} />
                      Download
                    </span>
                    <strong>
                      {plan.downloadMbps}
                      <small> Mbps</small>
                    </strong>
                    <em>Up to</em>
                  </div>
                  <div>
                    <span>
                      <LandingIcon name="zap" size={15} />
                      Upload
                    </span>
                    <strong>
                      {plan.uploadMbps}
                      <small> Mbps</small>
                    </strong>
                    <em>Up to</em>
                  </div>
                </div>
                <div className={styles.planIncluded}>
                  <p>Everything you need</p>
                  <span>
                    <LandingIcon name="check" size={16} />
                    Unlimited data
                  </span>
                  <span>
                    <LandingIcon name="check" size={16} />
                    No lock-in contract
                  </span>
                  <span>
                    <LandingIcon name="check" size={16} />
                    No setup fee
                  </span>
                </div>
                <div className={styles.planHighlights}>
                  <p>Best for</p>
                  {highlights.map((highlight) => (
                    <span key={highlight}>
                      <LandingIcon name="check" size={14} />
                      {highlight}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mt-5 text-sm text-slate-600">
                  {plan.downloadMbps}/{plan.uploadMbps} Mbps
                </p>
                <p className="mt-2 text-2xl font-bold">
                  ${(plan.monthlyCents / 100).toFixed(2)}
                  <span className="text-sm font-normal text-slate-500">/month, GST included</span>
                </p>
              </>
            )}
            <Link
              className={
                isLanding
                  ? styles.planButton
                  : 'button-primary mt-5 inline-flex w-full justify-center'
              }
              href={
                user?.role === 'CUSTOMER'
                  ? `/customer/subscription?planId=${encodeURIComponent(plan.id)}`
                  : `/checkout?planId=${encodeURIComponent(plan.id)}`
              }
            >
              {user?.role === 'CUSTOMER' ? 'Review this plan' : 'Choose plan'}
              {isLanding ? <LandingIcon name="arrow" size={16} /> : null}
            </Link>
          </article>
        );
      })}
    </div>
  );
}
