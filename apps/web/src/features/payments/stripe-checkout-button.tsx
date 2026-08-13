'use client';

import { useMutation } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

interface CheckoutSessionResponse {
  checkoutUrl: string;
}

export function StripeCheckoutButton({ invoiceId }: Readonly<{ invoiceId: string }>) {
  const { accessToken } = useAuth();
  const checkout = useMutation({
    mutationFn: () =>
      apiRequest<CheckoutSessionResponse>(
        '/payments/checkout-session',
        { method: 'POST', body: JSON.stringify({ invoiceId }) },
        accessToken,
      ),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
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
    </div>
  );
}
