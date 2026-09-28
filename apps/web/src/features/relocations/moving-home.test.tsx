import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('requires complete service and billing addresses and submits the selected billing token', async () => {
    const user = userEvent.setup();
    const serviceAddress = {
      selectionToken: 's'.repeat(43),
      formattedAddress: 'Unit 5, 25 Example Street, Adelaide SA 5000, Australia',
      unit: '5',
      houseNumber: '25',
      street: 'Example Street',
      suburb: 'Adelaide',
      state: 'South Australia',
      stateCode: 'SA',
      postcode: '5000',
      countryCode: 'AU',
    };
    const billingAddress = {
      selectionToken: 'b'.repeat(43),
      formattedAddress: 'Unit 4, 40 Billing Road, Norwood SA 5067, Australia',
      unit: '4',
      houseNumber: '40',
      street: 'Billing Road',
      suburb: 'Norwood',
      state: 'South Australia',
      stateCode: 'SA',
      postcode: '5067',
      countryCode: 'AU',
    };
    apiRequestMock.mockImplementation(async (path, options) => {
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
              addressLine1: '10 Old Street',
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
        return undefined as never;
      }
      if (path.startsWith('/coverage/address-suggestions?query=')) {
        return {
          suggestions: path.includes('Billing') ? [billingAddress] : [serviceAddress],
        } as never;
      }
      if (path === `/subscriptions/${subscriptionId}/relocations/qualification`) {
        return {
          available: true,
          status: 'AVAILABLE',
          message: 'Service is available.',
          currentPlanCompatible: true,
          currentPlanId: 'plan-id',
          address: {
            formattedAddress: serviceAddress.formattedAddress,
            suburb: serviceAddress.suburb,
            stateCode: serviceAddress.stateCode,
            postcode: serviceAddress.postcode,
          },
          qualification: {
            technology: 'FTTP',
            maximumSpeedMbps: 1000,
            source: 'DATABASE_ESTIMATE',
            checkedAt: '2026-09-28T00:00:00.000Z',
          },
          plans: [
            {
              id: 'plan-id',
              name: 'Essential 50',
              description: null,
              downloadMbps: 50,
              uploadMbps: 20,
              monthlyCents: 6900,
            },
          ],
          qualificationToken: 'q'.repeat(43),
        } as never;
      }
      if (path === `/subscriptions/${subscriptionId}/relocations` && options?.method === 'POST') {
        return { id: 'relocation-id' } as never;
      }
      if (path === '/relocations/relocation-id/confirm') {
        return { id: 'relocation-id', status: 'CONFIRMED' } as never;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MovingHome />
      </QueryClientProvider>,
    );

    await user.type(
      await screen.findByRole('combobox', { name: 'New service address' }),
      '25 Example',
    );
    await user.click(await screen.findByRole('option', { name: serviceAddress.formattedAddress }));
    expect(screen.getByText('Unit 5, 25')).toBeInTheDocument();
    expect(screen.getByText('Example Street')).toBeInTheDocument();
    expect(screen.getByText('Adelaide')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check availability' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to plan' }));
    await user.click(screen.getByRole('button', { name: 'Continue to move date' }));
    const moveDate = new Date();
    moveDate.setDate(moveDate.getDate() + 30);
    fireEvent.change(screen.getByLabelText('Requested activation date'), {
      target: { value: moveDate.toISOString().slice(0, 10) },
    });
    await user.click(screen.getByRole('button', { name: 'Review move' }));

    const sameAsService = screen.getByRole('checkbox', {
      name: 'Use the new service address for billing',
    });
    expect(sameAsService).toBeChecked();
    await user.click(sameAsService);
    const confirm = screen.getByRole('button', { name: 'Confirm move' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByRole('combobox', { name: 'Billing address' }), '40 Billing');
    await user.click(await screen.findByRole('option', { name: billingAddress.formattedAddress }));
    expect(screen.getByText('Unit 4, 40')).toBeInTheDocument();
    expect(screen.getByText('Billing Road')).toBeInTheDocument();
    expect(screen.getAllByText('Norwood').length).toBeGreaterThan(0);
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      const createCall = apiRequestMock.mock.calls.find(
        ([path]) => path === `/subscriptions/${subscriptionId}/relocations`,
      );
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          billingSameAsService: false,
          billingAddressSelectionToken: billingAddress.selectionToken,
        }),
      );
    });
    expect(await screen.findByText('Your relocation is confirmed')).toBeInTheDocument();
  });
});
