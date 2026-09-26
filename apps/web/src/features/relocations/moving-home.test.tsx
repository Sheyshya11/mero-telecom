import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { MovingHome } from './moving-home';

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: {
      id: 'customer-user',
      email: 'customer@example.test',
      role: 'CUSTOMER',
      roles: ['CUSTOMER'],
    },
  }),
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);
const subscriptionId = 'b3f8b389-2c04-421d-af98-861b339f43c8';

describe('MovingHome', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/subscriptions/me') {
        return [
          {
            id: subscriptionId,
            status: 'ACTIVE',
            monthlyCents: 6900,
            startDate: '2026-09-23T00:00:00.000Z',
            currentPeriodEnd: '2026-10-23T00:00:00.000Z',
            plan: {
              id: 'plan-id',
              name: 'Essential 50',
              downloadMbps: 50,
              uploadMbps: 20,
              monthlyCents: 6900,
            },
            currentServiceAddress: {
              id: 'service-address-id',
              addressLine1: '10 Example Street',
              addressLine2: null,
              suburb: 'Adelaide',
              state: 'SA',
              postcode: '5000',
              countryCode: 'AU',
              technology: 'FTTP',
              serviceClass: null,
              maximumSpeedMbps: 1000,
            },
          },
        ] as never;
      }
      if (path === `/subscriptions/${subscriptionId}/relocations/current`) {
        // Nest serializes a null controller result as an empty response body, which
        // the shared API client represents as undefined.
        return undefined as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('normalizes an empty current-relocation response to a stable null query result', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MovingHome />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Where are you moving?' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryData(['current-relocation', subscriptionId])).toBeNull(),
    );
  });
});
