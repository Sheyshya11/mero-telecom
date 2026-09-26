import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { CustomerProfile } from './customer-profile';
import type { Customer } from './customer.types';

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

const customer: Customer = {
  id: 'customer-id',
  customerNumber: 'CUST-0001',
  firstName: 'Alex',
  lastName: 'Taylor',
  email: 'customer@example.test',
  phone: '0400000000',
  addressLine1: '1 Residential Road',
  addressLine2: null,
  suburb: 'Norwood',
  state: 'SA',
  postcode: '5067',
  serviceAddress: {
    addressLine1: '20 Service Street',
    addressLine2: 'Unit 2',
    suburb: 'Adelaide',
    state: 'SA',
    postcode: '5000',
  },
  contactAddress: {
    addressLine1: '1 Billing Road',
    addressLine2: 'Unit 4',
    suburb: 'Norwood',
    state: 'SA',
    postcode: '5067',
  },
  status: 'ACTIVE',
  accountStatus: 'ACTIVE',
  invitationStatus: 'ACCEPTED',
  currentSubscription: null,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
};

describe('CustomerProfile', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(customer as never);
  });

  it('shows the contact and billing address without exposing service-address editing', async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerProfile />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'My profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Contact / billing address')).toHaveValue('1 Billing Road');
    expect(screen.getByLabelText('Address line 2')).toHaveValue('Unit 4');
    expect(screen.getByLabelText('Postcode')).toHaveValue('5067');
    expect(screen.queryByDisplayValue('20 Service Street')).not.toBeInTheDocument();
  });
});
