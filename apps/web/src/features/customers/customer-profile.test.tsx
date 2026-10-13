import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    await waitFor(() =>
      expect(screen.getByLabelText('Contact / billing address')).toHaveValue('1 Billing Road'),
    );
    expect(screen.getByLabelText('Address line 2')).toHaveValue('Unit 4');
    expect(screen.getByLabelText('Postcode')).toHaveValue('5067');
    expect(screen.queryByDisplayValue('20 Service Street')).not.toBeInTheDocument();
  });
  it('saves the customer name with a formatted mobile and refreshes the displayed name', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    apiRequestMock.mockImplementation(async (_path, options) =>
      options?.method === 'PATCH'
        ? { ...customer, ...JSON.parse(options.body as string) }
        : ({ ...customer, phone: '0400 000 000' } as never),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <CustomerProfile />
      </QueryClientProvider>,
    );
    const firstName = await screen.findByLabelText('First name');
    await waitFor(() => expect(firstName).toHaveValue('Alex'));
    await user.clear(firstName);
    await user.type(firstName, '  Sam  ');
    await user.clear(screen.getByLabelText('Last name'));
    await user.type(screen.getByLabelText('Last name'), '  Lee  ');
    await user.clear(screen.getByLabelText('Mobile'));
    await user.type(screen.getByLabelText('Mobile'), '+61 (400) 000-000');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/customers/me',
        {
          method: 'PATCH',
          body: JSON.stringify({
            firstName: 'Sam',
            lastName: 'Lee',
            phone: '+61400000000',
            addressLine1: '1 Billing Road',
            addressLine2: 'Unit 4',
            suburb: 'Norwood',
            state: 'SA',
            postcode: '5067',
          }),
        },
        'token',
      ),
    );
    expect(await screen.findByText('Sam Lee')).toBeInTheDocument();
    expect(await screen.findByText('Profile updated successfully.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customer-dashboard'] });
  });

  it('rejects a blank name without submitting the profile', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerProfile />
      </QueryClientProvider>,
    );
    const firstName = await screen.findByLabelText('First name');
    await waitFor(() => expect(firstName).toHaveValue('Alex'));
    await user.clear(firstName);
    await user.type(firstName, '   ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      '/customers/me',
      expect.objectContaining({ method: 'PATCH' }),
      expect.anything(),
    );
  });

  it('lets the owner change email with password confirmation without editing another account', async () => {
    const user = userEvent.setup();
    apiRequestMock.mockImplementation(async (path) =>
      path === '/customers/me/email'
        ? { ...customer, email: 'new@example.test' }
        : (customer as never),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <CustomerProfile />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: 'My profile' });
    await user.type(screen.getByLabelText('New email'), 'NEW@example.test');
    await user.type(screen.getByLabelText('Current password'), 'Password1!');
    await user.click(screen.getByRole('button', { name: 'Change email' }));
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/customers/me/email',
        {
          method: 'PATCH',
          body: JSON.stringify({ newEmail: 'new@example.test', currentPassword: 'Password1!' }),
        },
        'token',
      ),
    );
    expect(
      await screen.findByText('Email changed. Use your new email next time you sign in.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByText('new@example.test')).toBeInTheDocument();
  });
  it('does not submit an email change without the current password', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CustomerProfile />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: 'My profile' });
    await user.type(screen.getByLabelText('New email'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByText('Current password is required.')).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      '/customers/me/email',
      expect.anything(),
      expect.anything(),
    );
  });
});
