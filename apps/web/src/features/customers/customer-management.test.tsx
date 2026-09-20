import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCustomer,
  getCustomers,
  resendCustomerInvitation,
  updateCustomer,
} from './customer.api';
import { CustomerManagement } from './customer-management';
import type { Customer } from './customer.types';

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

vi.mock('../plans/use-plan-options', () => ({ usePlanOptions: () => [] }));
vi.mock('./customer.api', () => ({
  createCustomer: vi.fn(),
  getCustomers: vi.fn(),
  resendCustomerInvitation: vi.fn(),
  updateCustomer: vi.fn(),
}));

const customer: Customer = {
  id: 'customer-id',
  customerNumber: 'CUST-0001',
  firstName: 'Alex',
  lastName: 'Taylor',
  email: 'alex@example.test',
  phone: '0400000000',
  addressLine1: '10 Example Street',
  addressLine2: null,
  suburb: 'Adelaide',
  state: 'SA',
  postcode: '5000',
  status: 'INVITATION_PENDING',
  accountStatus: 'INVITATION_PENDING',
  invitationStatus: 'PENDING',
  serviceAddress: null,
  currentSubscription: null,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
};

describe('CustomerManagement', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/control-centre/customers');
    vi.mocked(createCustomer).mockReset();
    vi.mocked(updateCustomer).mockReset();
    vi.mocked(resendCustomerInvitation).mockReset();
    vi.mocked(getCustomers).mockResolvedValue({
      data: [customer],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  function renderPage() {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerManagement />
      </QueryClientProvider>,
    );
  }

  it('shows an actionable warning when invitation email delivery is not queued', async () => {
    vi.mocked(resendCustomerInvitation).mockResolvedValue({ queued: false });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Resend invitation' }));

    expect(
      await screen.findByText(/invitation link was created, but its email could not be queued/i),
    ).toBeInTheDocument();
  });

  it('labels the edit dialog and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog', { name: 'Edit customer' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Edit customer' })).not.toBeInTheDocument();
  });
});
