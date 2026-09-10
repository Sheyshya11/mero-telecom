import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CancellationProviderStatus, MockDisconnectionScenario } from '@prisma/client';

import type { AppConfig } from '../../../config/configuration';
import {
  type DisconnectionProviderResult,
  type DisconnectionRequestInput,
  type DisconnectionStatusInput,
  WholesaleDisconnectionProvider,
} from './wholesale-disconnection.provider';

@Injectable()
export class MockNbnProvider extends WholesaleDisconnectionProvider {
  readonly name = 'MOCK_NBN';
  readonly simulated = true;
  private readonly pendingPolls: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    super();
    this.pendingPolls = configService.getOrThrow('cancellation').mockPendingPolls;
  }

  async requestDisconnection(
    input: DisconnectionRequestInput,
  ): Promise<DisconnectionProviderResult> {
    const providerReference = `MOCK-${input.operation === 'DISCONNECT_SERVICE' ? 'DISC' : 'WITHDRAW'}-${input.requestNumber}`;
    return this.result(providerReference, input.scenario, 0, input.operation);
  }

  async getDisconnectionStatus(
    input: DisconnectionStatusInput,
  ): Promise<DisconnectionProviderResult> {
    const pollCount = input.pollCount + 1;
    if (input.scenario === MockDisconnectionScenario.PENDING) {
      return {
        providerReference: input.providerReference,
        status:
          pollCount >= this.pendingPolls
            ? CancellationProviderStatus.COMPLETED
            : CancellationProviderStatus.PENDING,
        payload: {
          simulated: true,
          scenario: input.scenario,
          pollCount,
          operation: input.operation,
        },
      };
    }
    return this.result(input.providerReference, input.scenario, pollCount, input.operation);
  }

  async cancelPendingDisconnection(input: {
    providerReference: string;
    operation: DisconnectionStatusInput['operation'];
  }): Promise<DisconnectionProviderResult> {
    return {
      providerReference: input.providerReference,
      status: CancellationProviderStatus.CANCELLED,
      payload: { simulated: true, operation: input.operation, cancelled: true },
    };
  }

  private result(
    providerReference: string,
    scenario: MockDisconnectionScenario,
    pollCount: number,
    operation: DisconnectionStatusInput['operation'],
  ): DisconnectionProviderResult {
    const status =
      scenario === MockDisconnectionScenario.SUCCESS
        ? CancellationProviderStatus.COMPLETED
        : scenario === MockDisconnectionScenario.FAILED
          ? CancellationProviderStatus.FAILED
          : scenario === MockDisconnectionScenario.MANUAL_REVIEW_REQUIRED
            ? CancellationProviderStatus.MANUAL_REVIEW_REQUIRED
            : CancellationProviderStatus.PENDING;
    return {
      providerReference,
      status,
      payload: { simulated: true, scenario, pollCount, operation },
      ...(status === CancellationProviderStatus.FAILED
        ? { failureReason: 'Mock provider rejected the simulated service operation.' }
        : status === CancellationProviderStatus.MANUAL_REVIEW_REQUIRED
          ? { failureReason: 'Mock provider requires manual operational review.' }
          : {}),
    };
  }
}
