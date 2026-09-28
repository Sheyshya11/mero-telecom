import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../../lib/api/client';
import CustomerSubscriptionPage from './page';

vi.mock('../../../features/auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: {
      id: 'multi-role-user',
      email: 'customer@example.test',
      role: 'STAFF',
      roles: ['CUSTOMER', 'STAFF'],
    },
  }),
}));

vi.mock('../../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/api/client')>('../../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

describe('CustomerSubscriptionPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/customer/subscription');
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/subscriptions/me' || path === '/plans/public') return [] as never;
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('allows a multi-role customer to view their subscription workspace', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'My subscription' })).toBeInTheDocument();
    expect(screen.queryByText('Customer access is required.')).not.toBeInTheDocument();
  });

  it('reconciles automatic-payment setup on return and displays the saved card', async () => {
    window.history.replaceState(
      null,
      '',
      '/customer/subscription?recurring=enabled&sessionId=cs_test_recurring_return',
    );
    let subscriptionRequests = 0;
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/account-ledger/me') return [] as never;
      if (path === '/account-ledger/me/finance') {
        return {
          regularPlanChargeCents: 8_900,
          availableCreditCents: 0,
          outstandingCents: 0,
          estimatedNextAmountCents: 8_900,
        } as never;
      }
      if (path === '/payments/recurring-setup-status?sessionId=cs_test_recurring_return') {
        return {
          checkoutStatus: 'complete',
          setupStatus: 'enabled',
          subscription: {
            id: 'subscription-id',
            billingMode: 'STRIPE_RECURRING',
            paymentMethodType: 'CARD',
            paymentMethodBrand: 'visa',
            paymentMethodLast4: '4242',
            paymentMethodExpMonth: 12,
            paymentMethodExpYear: 2030,
          },
        } as never;
      }
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: true,
          paymentMethods: [
            {
              id: 'pm_recurring_return',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              expMonth: 12,
              expYear: 2030,
              createdAt: '2026-09-28T00:00:00.000Z',
              isDefault: true,
              isExpired: false,
              canRemove: false,
              removalBlockedReason:
                'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.',
            },
          ],
        } as never;
      }
      if (path === '/subscriptions/me') {
        subscriptionRequests += 1;
        const recurring = subscriptionRequests > 1;
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            billingMode: recurring ? 'STRIPE_RECURRING' : 'MANUAL',
            stripeStatus: recurring ? 'trialing' : null,
            cancelAtPeriodEnd: false,
            paymentMethodType: recurring ? 'CARD' : null,
            paymentMethodBrand: recurring ? 'visa' : null,
            paymentMethodLast4: recurring ? '4242' : null,
            paymentMethodExpMonth: recurring ? 12 : null,
            paymentMethodExpYear: recurring ? 2030 : null,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            nextBillingAt: recurring ? '2026-10-01T00:00:00.000Z' : null,
            monthlyCents: 8_900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8_900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText('Your payment method was saved. Automatic payments are now enabled.'),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Visa •••• 4242')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enable automatic payments' }),
    ).not.toBeInTheDocument();
  });

  it('offers Moving Home for an active service', async () => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            monthlyCents: 8900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Move my service' })).toHaveAttribute(
      'href',
      '/customer/subscription/moving-home',
    );
  });

  it('shows masked Stripe methods and explains why the only recurring card cannot be removed', async () => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: true,
          paymentMethods: [
            {
              id: 'pm_owned',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              expMonth: 12,
              expYear: 2030,
              isDefault: true,
              isExpired: false,
              canRemove: false,
              removalBlockedReason:
                'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.',
            },
          ],
        } as never;
      }
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            billingMode: 'STRIPE_RECURRING',
            stripeStatus: 'active',
            cancelAtPeriodEnd: false,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            nextBillingAt: '2026-10-01T00:00:00.000Z',
            monthlyCents: 8900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Visa •••• 4242')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Visa •••• 4242' })).toBeDisabled();
    expect(
      screen.getByText(
        'Payment details are stored securely by Stripe. Your default method is used for future automatic payments.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('$89.00 AUD')).toBeInTheDocument();
  });

  it('keeps saved payment methods visible and removable after service cancellation', async () => {
    const user = userEvent.setup();
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/account-ledger/me') return [] as never;
      if (path === '/account-ledger/me/finance') {
        return {
          regularPlanChargeCents: 8_900,
          availableCreditCents: 0,
          outstandingCents: 0,
          estimatedNextAmountCents: 0,
        } as never;
      }
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: false,
          paymentMethods: [
            {
              id: 'pm_cancelled_service',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              expMonth: 12,
              expYear: 2030,
              billingDetails: {
                name: 'Subham Example',
                email: 'customer@example.test',
                phone: '+61400000000',
                address: {
                  line1: '9 Test Street',
                  line2: '',
                  city: 'Adelaide',
                  state: 'SA',
                  postalCode: '5000',
                  country: 'AU',
                },
              },
              createdAt: '2026-09-01T00:00:00.000Z',
              isDefault: true,
              isExpired: false,
              canRemove: true,
              removalBlockedReason: null,
            },
          ],
        } as never;
      }
      if (
        path === '/payments/payment-methods/pm_cancelled_service' &&
        options?.method === 'PATCH'
      ) {
        return { updated: true } as never;
      }
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'cancelled-subscription-id',
            status: 'CANCELLED',
            billingMode: 'STRIPE_RECURRING',
            stripeStatus: 'canceled',
            cancelAtPeriodEnd: false,
            paymentMethodType: 'CARD',
            paymentMethodBrand: 'visa',
            paymentMethodLast4: '4242',
            paymentMethodExpMonth: 12,
            paymentMethodExpYear: 2030,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-08-01T00:00:00.000Z',
            currentPeriodEnd: '2026-09-01T00:00:00.000Z',
            nextBillingAt: null,
            monthlyCents: 8_900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8_900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Saved payment methods' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Automatic payments are off')).toBeInTheDocument();
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
    const editButton = screen.getByRole('button', { name: 'Edit Visa •••• 4242' });
    expect(editButton).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove Visa •••• 4242' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Enable automatic payments' }),
    ).not.toBeInTheDocument();

    await user.click(editButton);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Edit Visa •••• 4242');
    expect(screen.getByLabelText('Name on payment method')).toHaveValue('Subham Example');
    expect(screen.getByLabelText('Billing email')).toHaveValue('customer@example.test');
    expect(screen.getByLabelText('Address line 1')).toHaveValue('9 Test Street');
    expect(screen.getByLabelText('Expiry month')).toHaveValue(12);
    expect(screen.getByLabelText('Expiry year')).toHaveValue(2030);

    await user.clear(screen.getByLabelText('Name on payment method'));
    await user.type(screen.getByLabelText('Name on payment method'), 'Updated Customer');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/payments/payment-methods/pm_cancelled_service',
        {
          method: 'PATCH',
          body: JSON.stringify({
            billingName: 'Updated Customer',
            billingEmail: 'customer@example.test',
            billingPhone: '+61400000000',
            billingAddressLine1: '9 Test Street',
            billingAddressLine2: '',
            billingCity: 'Adelaide',
            billingState: 'SA',
            billingPostalCode: '5000',
            billingCountry: 'AU',
            cardExpMonth: 12,
            cardExpYear: 2030,
          }),
        },
        'token',
      );
    });
    expect(await screen.findByText('Visa •••• 4242 details were updated.')).toBeInTheDocument();
  });

  it('shows a saved Link payment method returned by Stripe', async () => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: true,
          paymentMethods: [
            {
              id: 'pm_link',
              type: 'link',
              brand: null,
              last4: null,
              expMonth: null,
              expYear: null,
              isDefault: true,
              isExpired: false,
              canRemove: false,
              removalBlockedReason:
                'Add another payment method before removing this one. Your current payment method is being used for automatic subscription payments.',
            },
          ],
        } as never;
      }
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            billingMode: 'STRIPE_RECURRING',
            stripeStatus: 'active',
            cancelAtPeriodEnd: false,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            nextBillingAt: '2026-10-01T00:00:00.000Z',
            monthlyCents: 8900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Link')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Managed securely by Stripe')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('asks for confirmation before removing a saved payment method', async () => {
    const user = userEvent.setup();
    const removablePath = '/payments/payment-methods/pm_backup';
    apiRequestMock.mockImplementation(async (path, options) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === removablePath && options?.method === 'DELETE') {
        return { removed: true } as never;
      }
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: true,
          paymentMethods: [
            {
              id: 'pm_default',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              expMonth: 12,
              expYear: 2030,
              isDefault: true,
              isExpired: false,
              canRemove: false,
              removalBlockedReason:
                'Set another payment method as the default before removing this one.',
            },
            {
              id: 'pm_backup',
              type: 'card',
              brand: 'mastercard',
              last4: '4444',
              expMonth: 10,
              expYear: 2031,
              isDefault: false,
              isExpired: false,
              canRemove: true,
              removalBlockedReason: null,
            },
          ],
        } as never;
      }
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            billingMode: 'STRIPE_RECURRING',
            stripeStatus: 'active',
            cancelAtPeriodEnd: false,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            nextBillingAt: '2026-10-01T00:00:00.000Z',
            monthlyCents: 8900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Remove Mastercard •••• 4444' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Mastercard •••• 4444 will no longer be available for future payments.',
    );
    expect(apiRequestMock.mock.calls.some(([path]) => path === removablePath)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Remove payment method' }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(removablePath, { method: 'DELETE' }, 'token');
    });
  });

  it('warns about expired cards and does not allow them to become the default', async () => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/plan-change-requests/me?limit=1') return { data: [] } as never;
      if (path === '/plans/public') return [] as never;
      if (path === '/payments/payment-methods') {
        return {
          hasProtectedRecurringSubscription: true,
          paymentMethods: [
            {
              id: 'pm_default',
              type: 'card',
              brand: 'visa',
              last4: '4242',
              expMonth: 8,
              expYear: 2026,
              isDefault: true,
              isExpired: true,
              canRemove: false,
              removalBlockedReason:
                'Set another payment method as the default before removing this one.',
            },
            {
              id: 'pm_expired',
              type: 'card',
              brand: 'mastercard',
              last4: '0000',
              expMonth: 7,
              expYear: 2026,
              isDefault: false,
              isExpired: true,
              canRemove: true,
              removalBlockedReason: null,
            },
          ],
        } as never;
      }
      if (path === '/subscriptions/me') {
        return [
          {
            id: 'subscription-id',
            status: 'ACTIVE',
            billingMode: 'STRIPE_RECURRING',
            stripeStatus: 'active',
            cancelAtPeriodEnd: false,
            startDate: '2026-01-01T00:00:00.000Z',
            currentPeriodStart: '2026-09-01T00:00:00.000Z',
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
            nextBillingAt: '2026-10-01T00:00:00.000Z',
            monthlyCents: 8900,
            plan: {
              id: 'plan-id',
              name: 'NBN 100/20',
              description: null,
              highlights: [],
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: 8900,
              isFeatured: false,
            },
          },
        ] as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerSubscriptionPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Your default payment method has expired')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set Mastercard •••• 0000 as default' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        'This card can’t be used for future payments. Add a current payment method.',
      ),
    ).toHaveLength(2);
  });
});
