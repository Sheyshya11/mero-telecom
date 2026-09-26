import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../../lib/api/client';
import { RelocationDetail } from './relocation-detail';

const auth = vi.hoisted(() => ({ role: 'ADMIN' }));

vi.mock('../auth/auth-provider', () => ({
  useAuth: () => ({
    accessToken: 'token',
    isLoading: false,
    user: { id: 'internal-user', email: 'ops@example.test', role: auth.role, roles: [auth.role] },
  }),
}));

vi.mock('../../lib/api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, apiRequest: vi.fn() };
});

const apiRequestMock = vi.mocked(apiRequest);

describe('RelocationDetail', () => {
  beforeEach(() => {
    auth.role = 'ADMIN';
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(relocation() as never);
  });

  it('shows new and old service operations separately without reporting completion', async () => {
    renderDetail();
    expect(await screen.findByText('NEW SERVICE')).toBeInTheDocument();
    expect(screen.getByText('OLD SERVICE')).toBeInTheDocument();
    expect(screen.getByText('Partially completed')).toBeInTheDocument();
    expect(screen.getByText('Still connected or pending')).toBeInTheDocument();
    expect(screen.queryByText('SUPER ADMIN OVERRIDE')).not.toBeInTheDocument();
  });

  it('shows privileged controls only when the API grants Super Admin capabilities', async () => {
    auth.role = 'SUPER_ADMIN';
    apiRequestMock.mockResolvedValue(relocation(true) as never);
    renderDetail();
    expect(await screen.findByText('SUPER ADMIN OVERRIDE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review override' })).toBeInTheDocument();
  });

  it('offers only the simulated operation that can currently run', async () => {
    renderDetail();
    expect(await screen.findByText('SIMULATED PROVIDER')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Operation' })).toHaveValue('DISCONNECTION');
    expect(screen.getByRole('option', { name: 'New service provisioning' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Old service disconnection' })).toBeEnabled();
  });
});

function renderDetail() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RelocationDetail basePath="/control-centre/relocations" relocationId="relocation-id" />
    </QueryClientProvider>,
  );
}

function relocation(canOverride = false) {
  const address = {
    id: 'address-id',
    addressLine1: '10 Example Street',
    addressLine2: null,
    suburb: 'Adelaide',
    state: 'SA',
    postcode: '5000',
    technology: 'FTTP',
    serviceClass: '3',
    maximumSpeedMbps: 1000,
  };
  const plan = {
    id: 'plan-id',
    name: 'NBN 100/20',
    description: null,
    downloadMbps: 100,
    uploadMbps: 20,
    monthlyCents: 8900,
    isActive: true,
    isPublic: true,
    isAvailable: true,
  };
  return {
    id: 'relocation-id',
    subscriptionId: 'subscription-id',
    status: 'PARTIALLY_COMPLETED',
    requestedMoveDate: '2026-10-15T00:00:00.000Z',
    requestedOldServiceDisconnectionDate: null,
    qualificationStatus: 'AVAILABLE',
    provisioningStatus: 'COMPLETED',
    oldServiceDisconnectionStatus: 'PENDING',
    failureReason: null,
    disconnectionFailureReason: null,
    oldServiceAddress: address,
    newServiceAddress: { ...address, id: 'new-address', addressLine1: '25 Example Street' },
    currentPlan: plan,
    requestedPlan: plan,
    confirmedAt: '2026-09-24T00:00:00.000Z',
    newServiceActivatedAt: '2026-09-24T01:00:00.000Z',
    oldServiceDisconnectedAt: null,
    completedAt: null,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T01:00:00.000Z',
    attemptCount: 1,
    disconnectionAttemptCount: 1,
    canConfirm: false,
    canCancel: false,
    canRetry: false,
    customer: {
      id: 'customer-id',
      firstName: 'Asha',
      lastName: 'Shah',
      email: 'asha@example.test',
    },
    subscription: {
      id: 'subscription-id',
      status: 'ACTIVE',
      currentServiceAddressId: 'new-address',
    },
    providerMode: 'SIMULATED',
    providerName: 'MOCK_MNF',
    providerReference: 'MOCK-RELOC',
    disconnectionProviderReference: 'MOCK-DISCONNECT',
    notes: [],
    auditHistory: [],
    billing: null,
    escalation: null,
    capabilities: {
      canAddNote: true,
      canConfirm: false,
      canCancel: false,
      canRetryQualification: false,
      canRetryProvisioning: false,
      canRetryDisconnection: false,
      canReschedule: false,
      canEscalate: !canOverride,
      canConfigureDemo: true,
      canSimulateProvisioning: false,
      canSimulateDisconnection: true,
      canOverride,
      maxProvisioningAttempts: 3,
      maxDisconnectionAttempts: 3,
    },
  };
}
