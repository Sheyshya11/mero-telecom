import {
  CancellationProviderStatus,
  MockRelocationOutcome,
  ServiceProvisioningStatus,
} from '@prisma/client';

import { MockRelocationProvider } from './mock-relocation.provider';

function provider() {
  return new MockRelocationProvider({
    getOrThrow: () => ({
      provider: 'mock',
      reconciliationIntervalMilliseconds: 60_000,
      batchSize: 50,
      mockScenario: 'PENDING',
      mockPendingPolls: 1,
      maxProvisioningAttempts: 3,
      maxDisconnectionAttempts: 3,
    }),
  } as never);
}

const provisioningInput = {
  relocationId: 'relocation-id',
  subscriptionId: 'subscription-id',
  idempotencyKey: 'relocation-idempotency',
  requestedMoveDate: new Date(),
  oldServiceAddressId: 'old-address',
  newServiceAddressId: 'new-address',
};

describe('MockRelocationProvider', () => {
  it('uses a per-relocation provisioning failure deterministically', async () => {
    await expect(
      provider().requestProvisioning({
        ...provisioningInput,
        mockOutcome: MockRelocationOutcome.FAILED,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: ServiceProvisioningStatus.FAILED,
        failureReason: expect.any(String),
      }),
    );
  });

  it('moves a pending provisioning result to completed on the configured poll', async () => {
    const mock = provider();
    await expect(
      mock.requestProvisioning({
        ...provisioningInput,
        mockOutcome: MockRelocationOutcome.PENDING,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: ServiceProvisioningStatus.PENDING }));
    await expect(
      mock.getProvisioningStatus({
        providerReference: 'MOCK-RELOC-relocation-id',
        relocationId: 'relocation-id',
        pollCount: 0,
        mockOutcome: MockRelocationOutcome.PENDING,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: ServiceProvisioningStatus.COMPLETED }));
  });

  it('simulates disconnection failure and successful retry independently', async () => {
    const mock = provider();
    await expect(
      mock.requestDisconnection({
        relocationId: 'relocation-id',
        subscriptionId: 'subscription-id',
        idempotencyKey: 'disconnect-idempotency',
        oldServiceAddressId: 'old-address',
        mockOutcome: MockRelocationOutcome.FAILED,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: CancellationProviderStatus.FAILED }));
    await expect(
      mock.requestDisconnection({
        relocationId: 'relocation-id',
        subscriptionId: 'subscription-id',
        idempotencyKey: 'disconnect-idempotency',
        oldServiceAddressId: 'old-address',
        mockOutcome: MockRelocationOutcome.SUCCESS,
      }),
    ).resolves.toEqual(expect.objectContaining({ status: CancellationProviderStatus.COMPLETED }));
  });
});
