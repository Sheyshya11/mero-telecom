import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  MockDisconnectionScenario,
} from '@prisma/client';

import { MockNbnProvider } from './mock-nbn.provider';

describe('MockNbnProvider', () => {
  const buildProvider = (pendingPolls = 2) =>
    new MockNbnProvider({
      getOrThrow: jest.fn().mockReturnValue({ mockPendingPolls: pendingPolls }),
    } as never);

  const request = {
    requestNumber: 'CAN-2026-00001',
    subscriptionId: 'subscription-id',
    customerId: 'customer-id',
    effectiveAt: new Date('2026-09-10T00:00:00.000Z'),
    operation: CancellationProviderOperation.DISCONNECT_SERVICE,
    idempotencyKey: 'cancellation:CAN-2026-00001',
    scenario: MockDisconnectionScenario.PENDING,
  };

  it('returns a deterministic reference and never pretends to be a real provider', async () => {
    const provider = buildProvider();

    await expect(provider.requestDisconnection(request)).resolves.toEqual(
      expect.objectContaining({
        providerReference: 'MOCK-DISC-CAN-2026-00001',
        status: CancellationProviderStatus.PENDING,
        payload: expect.objectContaining({ simulated: true }),
      }),
    );
    expect(provider.name).toBe('MOCK_NBN');
    expect(provider.simulated).toBe(true);
  });

  it('moves a configured pending scenario to completed after deterministic polls', async () => {
    const provider = buildProvider(2);
    const input = {
      providerReference: 'MOCK-DISC-CAN-2026-00001',
      operation: CancellationProviderOperation.DISCONNECT_SERVICE,
      scenario: MockDisconnectionScenario.PENDING,
      pollCount: 0,
    };

    await expect(provider.getDisconnectionStatus(input)).resolves.toEqual(
      expect.objectContaining({ status: CancellationProviderStatus.PENDING }),
    );
    await expect(provider.getDisconnectionStatus({ ...input, pollCount: 1 })).resolves.toEqual(
      expect.objectContaining({ status: CancellationProviderStatus.COMPLETED }),
    );
  });

  it.each([
    [MockDisconnectionScenario.SUCCESS, CancellationProviderStatus.COMPLETED],
    [MockDisconnectionScenario.FAILED, CancellationProviderStatus.FAILED],
    [
      MockDisconnectionScenario.MANUAL_REVIEW_REQUIRED,
      CancellationProviderStatus.MANUAL_REVIEW_REQUIRED,
    ],
  ])('supports the %s development scenario', async (scenario, expectedStatus) => {
    const provider = buildProvider();

    await expect(provider.requestDisconnection({ ...request, scenario })).resolves.toEqual(
      expect.objectContaining({ status: expectedStatus }),
    );
  });

  it('supports revoking a provider operation that has not completed', async () => {
    const provider = buildProvider();

    await expect(
      provider.cancelPendingDisconnection({
        providerReference: 'MOCK-DISC-CAN-2026-00001',
        operation: CancellationProviderOperation.DISCONNECT_SERVICE,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: CancellationProviderStatus.CANCELLED,
        payload: expect.objectContaining({ simulated: true, cancelled: true }),
      }),
    );
  });
});
