import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { InvoiceManagement } from './invoice-management';
import type { Invoice, InvoiceSubscription } from './invoice.types';

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: {
      id: 'admin-user',
      email: 'admin@example.test',
      role: 'ADMIN',
      roles: ['ADMIN'],
    },
  }),
}));

vi.mock('../../lib/api/client', async () => {
  const original =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...original, apiRequest: vi.fn(), apiDownload: vi.fn() };
});

const subscription: InvoiceSubscription = {
  id: '4ccdfc07-0bac-40e6-93fe-728d00740379',
  status: 'ACTIVE',
  customer: { customerNumber: 'CUST-0001', firstName: 'Alex', lastName: 'Example' },
  plan: { name: 'Essential 50', monthlyCents: 6900 },
};

const existingInvoice: Invoice = {
  id: '6b34d995-21a6-4d36-8e28-1f465f93cc66',
  invoiceNumber: 'INV-2026-000001',
  issueDate: '2026-09-01T00:00:00.000Z',
  dueDate: '2026-09-15T00:00:00.000Z',
  billingPeriodStart: '2026-09-01T00:00:00.000Z',
  billingPeriodEnd: '2026-09-30T00:00:00.000Z',
  subtotalCents: 6273,
  taxCents: 627,
  totalCents: 6900,
  currency: 'AUD',
  status: 'PAID',
  customer: {
    id: 'customer-id',
    customerNumber: 'CUST-0001',
    firstName: 'Alex',
    lastName: 'Example',
    email: 'alex@example.test',
  },
  subscription: { id: subscription.id, plan: { id: 'plan-id', name: 'Essential 50' } },
  payments: [],
};

describe('InvoiceManagement', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/invoices');
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path.startsWith('/subscriptions?')) {
        return {
          data: [subscription],
          meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
        } as never;
      }
      if (path.startsWith('/invoices/billing-period?')) return existingInvoice as never;
      if (path.startsWith('/invoices?')) {
        return {
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        } as never;
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  it('shows the existing invoice and removes the generate action for that period', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <InvoiceManagement />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Active subscription' }));
    await user.click(await screen.findByRole('option', { name: /Alex Example/i }));

    expect(await screen.findByText(/invoice already exists/i)).toBeInTheDocument();
    expect(screen.getByText('INV-2026-000001', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).not.toBeInTheDocument();
  });
});
