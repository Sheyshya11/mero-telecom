import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
});
