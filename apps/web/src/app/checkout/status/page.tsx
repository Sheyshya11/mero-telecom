'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { MeroTelecomLogo } from '../../../components/brand/mero-telecom-logo';
import { apiRequest } from '../../../lib/api/client';

interface CheckoutStatus {
  status:
    | 'PENDING_PAYMENT'
    | 'PAYMENT_PROCESSING'
    | 'COMPLETED'
    | 'FAILED'
    | 'EXPIRED'
    | 'REQUIRES_REVIEW';
  paymentStatus: string | null;
  subscriptionStatus: string | null;
  accountStatus: string | null;
  activationRequired: boolean;
}

const terminalStatuses = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'REQUIRES_REVIEW']);

export default function CheckoutStatusPage() {
  return (
    <Suspense
      fallback={
        <StatusCard
          title="Confirming your payment…"
          message="Waiting for secure payment confirmation."
        />
      }
    >
      <CheckoutStatusContent />
    </Suspense>
  );
}

function CheckoutStatusContent() {
  const sessionId = useSearchParams().get('session_id') ?? '';
  const query = useQuery({
    queryKey: ['public-checkout-status', sessionId],
    queryFn: () =>
      apiRequest<CheckoutStatus>(
        `/payments/public-checkout-status?sessionId=${encodeURIComponent(sessionId)}`,
      ),
    enabled: sessionId.startsWith('cs_'),
    retry: 2,
    refetchInterval: (state) =>
      state.state.data && terminalStatuses.has(state.state.data.status) ? false : 2_000,
  });

  if (!sessionId || query.isError) {
    return (
      <StatusCard
        title="Payment status unavailable"
        message="We could not identify this Checkout Session. Contact support if payment was taken."
      />
    );
  }
  if (query.isPending || !query.data) {
    return (
      <StatusCard
        title="Confirming your payment…"
        message="Waiting for the verified Stripe result. Do not close this page yet."
      />
    );
  }
  if (query.data.status === 'COMPLETED') {
    return (
      <StatusCard
        title="Payment confirmed"
        message={
          query.data.activationRequired
            ? 'Your paid subscription is recorded and active. Check your email for the secure account-activation link before signing in.'
            : 'Your paid subscription is active and available in your dashboard.'
        }
      >
        <Link
          className="button-primary inline-flex"
          href={query.data.activationRequired ? '/activate/resend' : '/login'}
        >
          {query.data.activationRequired ? 'Resend activation email' : 'Sign in'}
        </Link>
      </StatusCard>
    );
  }
  if (query.data.status === 'FAILED' || query.data.status === 'EXPIRED') {
    return (
      <StatusCard
        title="Payment not completed"
        message="No subscription was activated. You can safely choose the plan again."
      >
        <Link className="button-primary inline-flex" href="/plans">
          Return to plans
        </Link>
      </StatusCard>
    );
  }
  if (query.data.status === 'REQUIRES_REVIEW') {
    return (
      <StatusCard
        title="Payment received—review required"
        message="Your payment record is preserved. Mero Telecom support must review an account or plan conflict before access is activated."
      />
    );
  }
  return (
    <StatusCard
      title="Payment is processing"
      message="Stripe has not finished confirming the payment. This page will continue checking automatically."
    />
  );
}

function StatusCard({
  title,
  message,
  children,
}: Readonly<{ title: string; message: string; children?: React.ReactNode }>) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Link aria-label="Mero Telecom home" className="inline-flex" href="/">
          <MeroTelecomLogo alt="" preload size="auth" />
        </Link>
        <h1 className="mt-3 text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-slate-600">{message}</p>
        {children ? <div className="mt-6">{children}</div> : null}
      </section>
    </main>
  );
}
