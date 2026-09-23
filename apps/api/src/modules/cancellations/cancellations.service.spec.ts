import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  CancellationStatus,
  CancellationType,
  InvoiceStatus,
  MockDisconnectionScenario,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { CancellationWorkflowPolicyService } from './cancellation-workflow-policy.service';
import { CancellationsService } from './cancellations.service';

describe('CancellationsService', () => {
  it('restores a scheduled cancellation to past due when an invoice became overdue', async () => {
    const effectiveAt = new Date('2099-10-01T00:00:00.000Z');
    const existing = {
      id: 'cancellation-id',
      requestNumber: 'CAN-2099-00001',
      subscriptionId: 'subscription-id',
      customerId: 'customer-id',
      type: CancellationType.END_OF_PERIOD,
      reason: 'PRICE',
      reasonDetails: null,
      requestedAt: new Date('2099-09-01T00:00:00.000Z'),
      effectiveAt,
      status: CancellationStatus.SCHEDULED,
      providerStatus: CancellationProviderStatus.NOT_SUBMITTED,
      providerOperation: CancellationProviderOperation.DISCONNECT_SERVICE,
      providerName: 'mock-wholesale',
      providerDisconnectionId: null,
      providerLastCheckedAt: null,
      providerPayload: null,
      failedReason: null,
      completedAt: null,
      revokedAt: null,
      version: 0,
      subscriptionStatusBefore: SubscriptionStatus.ACTIVE,
      customer: {
        id: 'customer-id',
        userId: 'customer-user-id',
        customerNumber: 'CUS-00001',
        firstName: 'Anika',
        lastName: 'Singh',
        email: 'anika@example.test',
      },
      subscription: {
        id: 'subscription-id',
        status: SubscriptionStatus.CANCELLATION_PENDING,
        plan: { name: 'Home 100' },
      },
      requestedBy: null,
      revokedBy: null,
      notes: [],
    };
    const revoked = { ...existing, status: CancellationStatus.REVOKED };
    const invoice = {
      id: 'invoice-id',
      status: InvoiceStatus.ISSUED,
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      overdueAt: null,
    };
    const subscriptionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      cancellationRequest: {
        findFirst: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(revoked),
      },
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          status: SubscriptionStatus.CANCELLATION_PENDING,
          suspensionReason: null,
        }),
        updateMany: subscriptionUpdateMany,
      },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        update: jest.fn().mockResolvedValue({
          ...invoice,
          status: InvoiceStatus.OVERDUE,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const provider = { name: 'mock-wholesale', simulated: true };
    const notifications = { sendCancellationNotification: jest.fn().mockResolvedValue({}) };
    const cache = { invalidate: jest.fn().mockResolvedValue(true) };
    const provisioning = { restoreService: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'cancellation'
          ? { batchSize: 50, mockScenario: MockDisconnectionScenario.SUCCESS }
          : { gracePeriodDays: 7, terminationDays: 30, batchSize: 50 },
      ),
    };
    const service = new CancellationsService(
      prisma as unknown as PrismaService,
      new CancellationWorkflowPolicyService(),
      provider as never,
      notifications as never,
      cache as never,
      provisioning as never,
      config as never,
    );
    const customer = {
      id: 'customer-user-id',
      email: 'anika@example.test',
      role: Role.CUSTOMER,
      roles: [Role.CUSTOMER],
    };

    await service.revoke('subscription-id', customer);

    expect(transaction.invoice.update).toHaveBeenCalledWith({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.OVERDUE, overdueAt: expect.any(Date) },
    });
    expect(subscriptionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SubscriptionStatus.PAST_DUE,
          pastDueAt: expect.any(Date),
          gracePeriodEndsAt: expect.any(Date),
          eligibleForTerminationAt: expect.any(Date),
        }),
      }),
    );
    expect(provisioning.restoreService).not.toHaveBeenCalled();
    expect(cache.invalidate).toHaveBeenCalled();
  });
});
