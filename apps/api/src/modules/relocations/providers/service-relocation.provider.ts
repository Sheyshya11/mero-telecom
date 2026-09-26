import {
  CancellationProviderStatus,
  type MockRelocationOutcome,
  ServiceProvisioningStatus,
} from '@prisma/client';

export interface RelocationProvisioningInput {
  relocationId: string;
  subscriptionId: string;
  idempotencyKey: string;
  requestedMoveDate: Date;
  oldServiceAddressId: string;
  newServiceAddressId: string;
  mockOutcome?: MockRelocationOutcome | null;
}

export interface RelocationProvisioningResult {
  providerReference: string;
  status: ServiceProvisioningStatus;
  payload: Record<string, string | number | boolean | null>;
  failureReason?: string;
}

export interface RelocationDisconnectionInput {
  relocationId: string;
  subscriptionId: string;
  idempotencyKey: string;
  oldServiceAddressId: string;
  mockOutcome?: MockRelocationOutcome | null;
}

export interface RelocationDisconnectionResult {
  providerReference: string;
  status: CancellationProviderStatus;
  payload: Record<string, string | number | boolean | null>;
  failureReason?: string;
}

/**
 * Boundary for wholesale relocation provisioning. A real MNF adapter can replace
 * the mock without changing workflow or exposing provider payloads to clients.
 */
export abstract class ServiceRelocationProvider {
  abstract readonly name: string;
  abstract readonly simulated: boolean;

  abstract requestProvisioning(
    input: RelocationProvisioningInput,
  ): Promise<RelocationProvisioningResult>;

  abstract getProvisioningStatus(input: {
    providerReference: string;
    relocationId: string;
    pollCount: number;
    mockOutcome?: MockRelocationOutcome | null;
  }): Promise<RelocationProvisioningResult>;

  abstract requestDisconnection(
    input: RelocationDisconnectionInput,
  ): Promise<RelocationDisconnectionResult>;

  abstract getDisconnectionStatus(input: {
    providerReference: string;
    relocationId: string;
    pollCount: number;
    mockOutcome?: MockRelocationOutcome | null;
  }): Promise<RelocationDisconnectionResult>;
}
