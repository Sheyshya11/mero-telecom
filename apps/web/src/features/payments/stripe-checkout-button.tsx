'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

interface CheckoutSessionResponse {
  checkoutUrl: string | null;
  reconciled?: boolean;
}

export function StripeCheckoutButton({ invoiceId }: Readonly<{ invoiceId: string }>) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const checkout = useMutation({
    mutationFn: () =>
      apiRequest<CheckoutSessionResponse>(
        '/payments/checkout-session',
        { method: 'POST', body: JSON.stringify({ invoiceId }) },
        accessToken,
      ),
    onSuccess: async ({ checkoutUrl }) => {
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      await queryClient.invalidateQueries();
    },
  });

  return (
    <div className="mt-4 sm:text-right">
      <button
        className="button-primary"
        disabled={checkout.isPending}
        onClick={() => checkout.mutate()}
        type="button"
      >
        {checkout.isPending ? 'Redirecting to Stripe...' : 'Pay securely with Stripe'}
      </button>
      {checkout.isError ? (
        <p className="mt-2 text-sm text-rose-700">Unable to start the secure payment session.</p>
      ) : null}
      {checkout.data?.reconciled ? (
        <p className="mt-2 text-sm text-emerald-700">Payment confirmed. Refreshing your account…</p>
      ) : null}
    </div>
  );
}

export function PlanCheckoutButton({ planId }: Readonly<{ planId: string }>) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const checkout = useMutation({
    mutationFn: () =>
      apiRequest<CheckoutSessionResponse>(
        '/payments/plan-checkout-session',
        { method: 'POST', body: JSON.stringify({ planId }) },
        accessToken,
      ),
    onSuccess: async ({ checkoutUrl }) => {
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['plan-change'] }),
      ]);
    },
  });

  return (
    <div className="mt-5">
      <button
        className="button-primary w-full"
        disabled={checkout.isPending}
        onClick={() => checkout.mutate()}
        type="button"
      >
        {checkout.isPending ? 'Opening secure checkout…' : 'Choose and pay'}
      </button>
      {checkout.isError ? (
        <p className="mt-2 text-sm text-rose-700">
          {checkout.error instanceof ApiError
            ? checkout.error.message
            : 'Unable to start the secure payment session.'}
        </p>
      ) : null}
      {checkout.data?.reconciled ? (
        <p className="mt-2 text-sm text-emerald-700">
          Payment confirmed. Your subscription is now active.
        </p>
      ) : null}
    </div>
  );
}
