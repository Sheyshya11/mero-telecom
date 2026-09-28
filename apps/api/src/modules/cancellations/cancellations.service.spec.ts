import {
  CancellationProviderOperation,
  CancellationProviderStatus,
  CancellationStatus,
  CancellationType,
  BillingMode,
  InvoiceType,
  InvoiceStatus,
  MockDisconnectionScenario,
  Role,
  SubscriptionStatus,
  PaymentProvider,
  PaymentStatus,
} from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CancellationWorkflowPolicyService } from './cancellation-workflow-policy.service';
import { CancellationsService } from './cancellations.service';

describe('CancellationsService', () => {
  it('previews only the paid current-period recurring payment and caps prior refunds', async () => {
    const currentPeriodStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000);
    const currentPeriodEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'invoice-current',
      totalCents: 9_900,
      payments: [
        {
          id: 'payment-current',
          amountCents: 9_900,
          provider: PaymentProvider.STRIPE,
          providerPaymentId: 'pi_current',
          status: PaymentStatus.PARTIALLY_REFUNDED,
        },
      ],
    });
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          customerId: 'customer-id',
          status: SubscriptionStatus.ACTIVE,
          billingMode: BillingMode.STRIPE_RECURRING,
          currentPeriodStart,
          currentPeriodEnd,
          customer: { userId: 'customer-user-id' },
          plan: { name: 'Home 100', monthlyCents: 9_900 },
        }),
      },
      invoice: {
        findFirst,
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
      },
      refund: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { refundAmountCents: 7_000 } })
          .mockResolvedValueOnce({ _sum: { refundAmountCents: 900 } }),
      },
    };
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
      { name: 'mock-wholesale', simulated: true } as never,
      {} as never,
      {} as never,
      {} as never,
      new BillingService(),
      {} as never,
      config as never,
    );
    const result = await service.preview('subscription-id', CancellationType.IMMEDIATE, {
      id: 'customer-user-id',
      email: 'anika@example.test',
      role: Role.CUSTOMER,
      roles: [Role.CUSTOMER],
    });

    expect(result.calculatedProrationCents).toBeGreaterThan(2_000);
    expect(result.previousSuccessfulRefundCents).toBe(7_000);
    expect(result.remainingRefundableCents).toBe(2_000);
    expect(result.automaticRefundCents).toBe(2_000);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionId: 'subscription-id',
          type: InvoiceType.STRIPE_RECURRING,
          status: InvoiceStatus.PAID,
        }),
      }),
    );
    expect(findFirst.mock.calls[0][0].include.payments.where).toEqual(
      expect.objectContaining({
        provider: PaymentProvider.STRIPE,
        providerPaymentId: { startsWith: 'pi_' },
      }),
    );
  });

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
      new BillingService(),
      {} as never,
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
