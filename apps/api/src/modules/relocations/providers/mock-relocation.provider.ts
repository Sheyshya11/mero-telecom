import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CancellationProviderStatus,
  type MockRelocationOutcome,
  ServiceProvisioningStatus,
} from '@prisma/client';

import type { AppConfig } from '../../../config/configuration';
import {
  type RelocationProvisioningInput,
  type RelocationProvisioningResult,
  type RelocationDisconnectionInput,
  type RelocationDisconnectionResult,
  ServiceRelocationProvider,
} from './service-relocation.provider';

@Injectable()
export class MockRelocationProvider extends ServiceRelocationProvider {
  readonly name = 'MOCK_MNF';
  readonly simulated = true;
  private readonly scenario: 'SUCCESS' | 'PENDING' | 'FAILED';
  private readonly pendingPolls: number;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const relocation = config.getOrThrow('relocation');
    this.scenario = relocation.mockScenario;
    this.pendingPolls = relocation.mockPendingPolls;
  }

  async requestProvisioning(
    input: RelocationProvisioningInput,
  ): Promise<RelocationProvisioningResult> {
    return this.provisioningResult(
      `MOCK-RELOC-${input.relocationId}`,
      0,
      input.mockOutcome ?? this.scenario,
    );
  }

  async getProvisioningStatus(input: {
    providerReference: string;
    relocationId: string;
    pollCount: number;
    mockOutcome?: MockRelocationOutcome | null;
  }): Promise<RelocationProvisioningResult> {
    return this.provisioningResult(
      input.providerReference,
      input.pollCount + 1,
      input.mockOutcome ?? this.scenario,
    );
  }

  async requestDisconnection(
    input: RelocationDisconnectionInput,
  ): Promise<RelocationDisconnectionResult> {
    return this.disconnectionResult(
      `MOCK-DISCONNECT-${input.relocationId}`,
      0,
      input.mockOutcome ?? this.scenario,
    );
  }

  async getDisconnectionStatus(input: {
    providerReference: string;
    relocationId: string;
    pollCount: number;
    mockOutcome?: MockRelocationOutcome | null;
  }): Promise<RelocationDisconnectionResult> {
    return this.disconnectionResult(
      input.providerReference,
      input.pollCount + 1,
      input.mockOutcome ?? this.scenario,
    );
  }

  private provisioningResult(
    providerReference: string,
    pollCount: number,
    scenario: MockRelocationOutcome | 'SUCCESS' | 'PENDING' | 'FAILED',
  ): RelocationProvisioningResult {
    const pending = scenario === 'PENDING' && pollCount < this.pendingPolls;
    const failed = scenario === 'FAILED';
    return {
      providerReference,
      status: failed
        ? ServiceProvisioningStatus.FAILED
        : pending
          ? ServiceProvisioningStatus.PENDING
          : ServiceProvisioningStatus.COMPLETED,
      payload: { simulated: true, scenario, pollCount },
      ...(failed ? { failureReason: 'Mock MNF relocation provisioning failed.' } : {}),
    };
  }

  private disconnectionResult(
    providerReference: string,
    pollCount: number,
    scenario: MockRelocationOutcome | 'SUCCESS' | 'PENDING' | 'FAILED',
  ): RelocationDisconnectionResult {
    const pending = scenario === 'PENDING' && pollCount < this.pendingPolls;
    const failed = scenario === 'FAILED';
    return {
      providerReference,
      status: failed
        ? CancellationProviderStatus.FAILED
        : pending
          ? CancellationProviderStatus.PENDING
          : CancellationProviderStatus.COMPLETED,
      payload: { simulated: true, scenario, pollCount, operation: 'DISCONNECT' },
      ...(failed ? { failureReason: 'Mock old-service disconnection failed.' } : {}),
    };
  }
}
