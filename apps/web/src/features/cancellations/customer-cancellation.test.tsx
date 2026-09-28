import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CustomerCancellation } from './customer-cancellation';

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

describe('CustomerCancellation', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/subscriptions/subscription-id/cancellation') {
        return { cancellation: null } as never;
      }
      if (path === '/subscriptions/subscription-id/cancellation/preview?type=IMMEDIATE') {
        return {
          currentPeriodStart: '2026-09-01T00:00:00.000Z',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          nextBillingAt: '2026-10-01T00:00:00.000Z',
          proposedServiceEndAt: '2026-09-14T00:00:00.000Z',
          outstandingBalanceCents: 9_900,
          currency: 'AUD',
          amountPaidCents: 9_900,
          eligibleRecurringAmountCents: 9_900,
          calculatedProrationCents: 5_610,
          previousSuccessfulRefundCents: 0,
          remainingRefundableCents: 9_900,
          automaticRefundCents: 5_610,
          refundAvailable: true,
          noRefundReason: null,
          refundDestination: 'Original payment method',
          billingMessage: 'Outstanding invoices remain payable. The unused period is refunded.',
        } as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it.each(['PAST_DUE', 'SUSPENDED'])(
    'offers immediate cancellation for a %s subscription and keeps debt visible',
    async (status) => {
      const user = userEvent.setup();
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <CustomerCancellation
            accessToken="token"
            subscription={{
              id: 'subscription-id',
              status,
              currentPeriodStart: '2026-09-01T00:00:00.000Z',
              currentPeriodEnd: '2026-10-01T00:00:00.000Z',
              monthlyCents: 9_900,
              plan: { name: 'Home 100', monthlyCents: 9_900 },
            }}
          />
        </QueryClientProvider>,
      );

      await user.click(await screen.findByRole('button', { name: 'Cancel Service' }));
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(
        screen.queryByRole('radio', { name: /end of my current billing period/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /as soon as possible/i })).toBeChecked();
      expect(screen.getByText(/outstanding invoices remain payable/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Review cancellation' }));
      await waitFor(() =>
        expect(apiRequestMock).toHaveBeenCalledWith(
          '/subscriptions/subscription-id/cancellation/preview?type=IMMEDIATE',
          {},
          'token',
        ),
      );
      expect(await screen.findByText('$99.00')).toBeInTheDocument();
      expect(await screen.findByText('$56.10')).toBeInTheDocument();
      expect(screen.getByText('Original payment method')).toBeInTheDocument();
    },
  );
});
