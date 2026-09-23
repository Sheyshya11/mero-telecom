import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CustomerInvoiceHistory } from './customer-invoice-history';

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
  return { ...actual, apiRequest: vi.fn(), apiDownload: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

describe('CustomerInvoiceHistory', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/customer/invoices');
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (path) => {
      const page = path.includes('page=2') ? 2 : 1;
      return {
        data: [
          {
            id: `invoice-${page}`,
            invoiceNumber: `INV-000${page}`,
            issueDate: '2026-09-01T00:00:00.000Z',
            dueDate: '2026-09-15T00:00:00.000Z',
            totalCents: 7999,
            status: 'PAID',
            payments: [],
          },
        ],
        meta: { page, limit: 20, total: 25, totalPages: 2 },
      } as never;
    });
  });

  it('loads additional invoice pages instead of truncating history', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerInvoiceHistory />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('INV-0001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/invoices/me?page=2&limit=20&sortBy=createdAt&sortOrder=desc',
        {},
        'token',
      ),
    );
    expect(await screen.findByText('INV-0002')).toBeInTheDocument();
  });
});
