import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  MockDisconnectionScenario,
} from '@prisma/client';

export interface DisconnectionRequestInput {
  requestNumber: string;
  subscriptionId: string;
  customerId: string;
  effectiveAt: Date;
  operation: CancellationProviderOperation;
  idempotencyKey: string;
  scenario: MockDisconnectionScenario;
}

export interface DisconnectionStatusInput {
  providerReference: string;
  operation: CancellationProviderOperation;
  scenario: MockDisconnectionScenario;
  pollCount: number;
}

export interface DisconnectionProviderResult {
  providerReference: string;
  status: CancellationProviderStatus;
  payload: Record<string, string | number | boolean | null>;
  failureReason?: string;
}

/**
 * Provider boundary for wholesale service operations. Implementations must honour
 * idempotencyKey so a process crash cannot submit the same disconnection twice.
 */
export abstract class WholesaleDisconnectionProvider {
  abstract readonly name: string;
  abstract readonly simulated: boolean;

  abstract requestDisconnection(
    input: DisconnectionRequestInput,
  ): Promise<DisconnectionProviderResult>;

  abstract getDisconnectionStatus(
    input: DisconnectionStatusInput,
  ): Promise<DisconnectionProviderResult>;

  abstract cancelPendingDisconnection(input: {
    providerReference: string;
    operation: CancellationProviderOperation;
  }): Promise<DisconnectionProviderResult>;
}
