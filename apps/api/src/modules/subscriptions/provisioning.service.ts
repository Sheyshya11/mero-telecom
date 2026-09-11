import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceProvisioningAction, ServiceProvisioningStatus } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);
  private readonly mockResult: 'SUCCESS' | 'PENDING' | 'FAILED';

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.mockResult = config.getOrThrow('overdueLifecycle').provisioningMockResult;
  }

  suspendService(subscriptionId: string, transitionAt: Date): Promise<void> {
    return this.request(
      subscriptionId,
      ServiceProvisioningAction.SUSPEND,
      `non-payment-suspend:${subscriptionId}:${transitionAt.toISOString()}`,
    );
  }

  restoreService(subscriptionId: string, transitionAt: Date): Promise<void> {
    return this.request(
      subscriptionId,
      ServiceProvisioningAction.RESTORE,
      `payment-restore:${subscriptionId}:${transitionAt.toISOString()}`,
    );
  }

  async reconcilePending(limit: number): Promise<number> {
    const requests = await this.prisma.serviceProvisioningRequest.findMany({
      where: {
        status: {
          in: [ServiceProvisioningStatus.PENDING, ServiceProvisioningStatus.FAILED],
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const request of requests) {
      await this.process(request.id);
    }
    return requests.length;
  }

  private async request(
    subscriptionId: string,
    action: ServiceProvisioningAction,
    idempotencyKey: string,
  ): Promise<void> {
    const request = await this.prisma.serviceProvisioningRequest.upsert({
      where: { idempotencyKey },
      create: { subscriptionId, action, idempotencyKey },
      update: {},
    });
    if (request.status === ServiceProvisioningStatus.COMPLETED) return;
    await this.process(request.id);
  }

  private async process(requestId: string): Promise<void> {
    const attemptedAt = new Date();
    const request = await this.prisma.serviceProvisioningRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status === ServiceProvisioningStatus.COMPLETED) return;

    if (this.mockResult === 'PENDING') {
      await this.prisma.$transaction([
        this.prisma.serviceProvisioningRequest.update({
          where: { id: request.id },
          data: { attemptCount: { increment: 1 }, lastAttemptAt: attemptedAt },
        }),
        this.prisma.subscription.update({
          where: { id: request.subscriptionId },
          data: { provisioningStatus: ServiceProvisioningStatus.PENDING },
        }),
      ]);
      return;
    }

    const completed = this.mockResult === 'SUCCESS';
    const failureReason = completed ? null : 'MOCK_PROVIDER_FAILURE';
    await this.prisma.$transaction([
      this.prisma.serviceProvisioningRequest.update({
        where: { id: request.id },
        data: {
          status: completed
            ? ServiceProvisioningStatus.COMPLETED
            : ServiceProvisioningStatus.FAILED,
          attemptCount: { increment: 1 },
          lastAttemptAt: attemptedAt,
          completedAt: completed ? attemptedAt : null,
          failureReason,
        },
      }),
      this.prisma.subscription.update({
        where: { id: request.subscriptionId },
        data: {
          provisioningStatus: completed
            ? ServiceProvisioningStatus.COMPLETED
            : ServiceProvisioningStatus.FAILED,
          provisioningFailure: failureReason,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          action: completed
            ? request.action === ServiceProvisioningAction.SUSPEND
              ? 'SERVICE_SUSPENSION_PROVISIONED'
              : 'SERVICE_RESTORED'
            : 'SERVICE_PROVISIONING_FAILED',
          entityType: 'Subscription',
          entityId: request.subscriptionId,
          metadata: {
            provider: 'MOCK',
            action: request.action,
            provisioningRequestId: request.id,
            failureReason,
          },
        },
      }),
    ]);
    this.logger.log(
      JSON.stringify({
        event: 'service_provisioning_processed',
        provider: 'MOCK',
        subscriptionId: request.subscriptionId,
        action: request.action,
        completed,
      }),
    );
  }
}
