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
});
