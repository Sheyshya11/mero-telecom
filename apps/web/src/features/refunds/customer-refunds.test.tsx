import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CustomerRefunds } from './customer-refunds';

vi.mock('../auth/auth-provider', () => ({
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

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

describe('CustomerRefunds', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/customer/refunds');
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path) => {
      if (path.startsWith('/invoices/me?')) {
        return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } } as never;
      }
      if (path.startsWith('/me/refunds?')) {
        return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } } as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it('allows a multi-role customer to use the customer refund workspace', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerRefunds />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Refunds' })).toBeInTheDocument();
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    expect(apiRequestMock.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        '/invoices/me?page=1&limit=20&sortBy=createdAt&sortOrder=desc',
        '/me/refunds?page=1&limit=20&sortBy=createdAt&sortOrder=desc',
      ]),
    );
  });
});
