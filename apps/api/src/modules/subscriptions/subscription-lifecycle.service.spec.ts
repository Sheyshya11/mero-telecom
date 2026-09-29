import {
  BillingMode,
  InvoiceCollectionStatus,
  InvoiceStatus,
  Role,
  SubscriptionStatus,
  SuspensionReason,
} from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

const paidInvoice = {
  id: 'invoice-id',
  invoiceNumber: 'INV-2026-000001',
  customerId: 'customer-id',
  subscriptionId: 'subscription-id',
  totalCents: 9_900,
  currency: 'AUD',
  status: InvoiceStatus.PAID,
  dueDate: new Date('2026-09-01T00:00:00.000Z'),
  customer: { firstName: 'Anika', lastName: 'Singh', email: 'anika@example.test' },
  subscription: {
    id: 'subscription-id',
    status: SubscriptionStatus.SUSPENDED,
    suspensionReason: SuspensionReason.NON_PAYMENT,
    gracePeriodEndsAt: new Date('2026-09-08T00:00:00.000Z'),
    suspendedAt: new Date('2026-09-08T00:00:00.000Z'),
  },
};

function makeService(options?: { invoice?: typeof paidInvoice; blocking?: boolean }) {
  const transaction = {
    invoice: { findUnique: jest.fn().mockResolvedValue(options?.invoice ?? paidInvoice) },
    subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const config = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'overdueLifecycle') {
        return { gracePeriodDays: 7, terminationDays: 30, batchSize: 50 };
      }
      return undefined;
    }),
  };
  const eligibility = {
    hasBlockingOutstandingBalance: jest.fn().mockResolvedValue(options?.blocking ?? false),
  };
  const provisioning = { restoreService: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    sendOverdueLifecycleNotification: jest.fn().mockResolvedValue({}),
  };
  const cache = { invalidate: jest.fn().mockResolvedValue(true) };
  const service = new SubscriptionLifecycleService(
    prisma as unknown as PrismaService,
    config as never,
    eligibility as never,
    provisioning as never,
    notifications as never,
    cache as never,
  );
  return { service, transaction, eligibility, provisioning };
}

describe('SubscriptionLifecycleService', () => {
  it('calculates the configured grace and termination dates', () => {
    const { service } = makeService();
    const overdueAt = new Date('2026-09-01T04:30:00.000Z');
    expect(service.gracePeriodEndsAt(overdueAt).toISOString()).toBe('2026-09-08T04:30:00.000Z');
    expect(service.eligibleForTerminationAt(overdueAt).toISOString()).toBe(
      '2026-10-01T04:30:00.000Z',
    );
  });

  it('restores a non-payment suspension only after all blocking invoices are paid', async () => {
    const { service, provisioning, transaction } = makeService();
    await service.handleConfirmedPayment(paidInvoice.id);
    expect(transaction.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
      }),
    );
    expect(provisioning.restoreService).toHaveBeenCalledWith('subscription-id', expect.any(Date));
  });

  it('does not restore when another blocking overdue invoice remains', async () => {
    const { service, provisioning, transaction } = makeService({ blocking: true });
    await service.handleConfirmedPayment(paidInvoice.id);
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
    expect(provisioning.restoreService).not.toHaveBeenCalled();
  });

  it('does not automatically restore a fraud suspension', async () => {
    const fraudInvoice = {
      ...paidInvoice,
      subscription: { ...paidInvoice.subscription, suspensionReason: SuspensionReason.FRAUD },
    };
    const { service, eligibility, transaction } = makeService({ invoice: fraudInvoice });
    await service.handleConfirmedPayment(paidInvoice.id);
    expect(eligibility.hasBlockingOutstandingBalance).not.toHaveBeenCalled();
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('repairs an active subscription whose invoice is already overdue', async () => {
    const overdueAt = new Date('2026-09-01T00:00:00.000Z');
    const invoice = {
      ...paidInvoice,
      status: InvoiceStatus.OVERDUE,
      overdueAt,
      subscription: {
        ...paidInvoice.subscription,
        status: SubscriptionStatus.ACTIVE,
        suspensionReason: null,
        plan: { name: 'Home 100' },
      },
    };
    const transaction = {
      invoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        update: jest.fn().mockResolvedValue(invoice),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      planChangeRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      invoice: { findMany: jest.fn().mockResolvedValue([{ id: invoice.id }]) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        gracePeriodDays: 7,
        terminationDays: 30,
        batchSize: 50,
      }),
    };
    const notifications = {
      sendOverdueLifecycleNotification: jest.fn().mockResolvedValue({}),
    };
    const cache = { invalidate: jest.fn().mockResolvedValue(true) };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      config as never,
      {} as never,
      {} as never,
      notifications as never,
      cache as never,
    );

    await expect(
      service.markDueInvoicesOverdue(new Date('2026-09-14T00:00:00.000Z')),
    ).resolves.toBe(1);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([expect.objectContaining({ status: InvoiceStatus.OVERDUE })]),
        }),
      }),
    );
    expect(transaction.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
      }),
    );
  });

  it('releases a notification claim when enqueueing the warning fails', async () => {
    const now = new Date('2026-09-07T12:00:00.000Z');
    const gracePeriodEndsAt = new Date('2026-09-08T00:00:00.000Z');
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.PAST_DUE,
      pastDueAt: new Date('2026-09-01T00:00:00.000Z'),
      gracePeriodEndsAt,
      suspendedAt: null,
      suspensionWarningSentAt: null,
      overdueReminderStage: 2,
      customer: paidInvoice.customer,
      invoices: [{ ...paidInvoice, status: InvoiceStatus.OVERDUE }],
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([subscription]),
        updateMany,
      },
      auditLog: { create: auditCreate },
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        gracePeriodDays: 7,
        terminationDays: 30,
        batchSize: 50,
      }),
    };
    const notifications = {
      sendOverdueLifecycleNotification: jest.fn().mockRejectedValue(new Error('queue offline')),
    };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      config as never,
      {} as never,
      {} as never,
      notifications as never,
      {} as never,
    );

    await expect(service.processNotifications(now)).resolves.toBe(0);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: subscription.id, suspensionWarningSentAt: null },
      data: { suspensionWarningSentAt: now },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: subscription.id, suspensionWarningSentAt: now },
      data: { suspensionWarningSentAt: null },
    });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('extends both the grace deadline and termination eligibility atomically', async () => {
    const subscription = {
      id: 'subscription-id',
      status: SubscriptionStatus.PAST_DUE,
      gracePeriodEndsAt: new Date('2026-09-08T00:00:00.000Z'),
      eligibleForTerminationAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const expected = {
      ...subscription,
      gracePeriodEndsAt: new Date('2026-09-11T00:00:00.000Z'),
      eligibleForTerminationAt: new Date('2026-10-04T00:00:00.000Z'),
    };
    const transaction = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subscription),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(expected),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        gracePeriodDays: 7,
        terminationDays: 30,
        batchSize: 50,
      }),
    };
    const cache = { invalidate: jest.fn().mockResolvedValue(true) };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
    );
    const admin = {
      id: 'admin-id',
      email: 'admin@example.test',
      role: Role.ADMIN,
      roles: [Role.ADMIN],
    };

    await expect(service.extendGracePeriod(subscription.id, 3, admin)).resolves.toEqual(expected);
    expect(transaction.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gracePeriodEndsAt: expected.gracePeriodEndsAt,
          eligibleForTerminationAt: expected.eligibleForTerminationAt,
          suspensionWarningSentAt: null,
        }),
      }),
    );
    expect(transaction.auditLog.create).toHaveBeenCalled();
    expect(cache.invalidate).toHaveBeenCalled();
  });

  it('records authentication-required state and sends the hosted Stripe action link', async () => {
    const invoice = {
      ...paidInvoice,
      status: InvoiceStatus.ISSUED,
      paidAt: null,
      overdueAt: null,
      stripeHostedUrl: null,
      stripeAttemptCount: 0,
      subscription: {
        ...paidInvoice.subscription,
        status: SubscriptionStatus.ACTIVE,
        suspensionReason: null,
        pastDueAt: null,
        plan: { name: 'Home 100' },
      },
    };
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue(invoice),
        update: jest.fn().mockResolvedValue(invoice),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      planChangeRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const notifications = {
      sendOverdueLifecycleNotification: jest.fn().mockResolvedValue({}),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        gracePeriodDays: 7,
        terminationDays: 30,
        batchSize: 50,
      }),
    };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      config as never,
      {} as never,
      {} as never,
      notifications as never,
      { invalidate: jest.fn().mockResolvedValue(true) } as never,
    );
    const requiredAt = new Date('2026-09-29T01:00:00.000Z');

    await service.handlePaymentActionRequired({
      providerEventId: 'evt_action_required',
      eventType: 'invoice.payment_action_required',
      invoiceId: invoice.id,
      expectedAmountCents: invoice.totalCents,
      expectedCurrency: 'aud',
      failedAt: requiredAt,
      attemptCount: 1,
      paymentErrorCode: 'authentication_required',
      hostedInvoiceUrl: 'https://invoice.stripe.test/authenticate',
    });

    expect(transaction.invoice.update).toHaveBeenCalledWith({
      where: { id: invoice.id },
      data: expect.objectContaining({
        collectionStatus: InvoiceCollectionStatus.ACTION_REQUIRED,
        stripeAttemptCount: 1,
        paymentActionRequiredAt: requiredAt,
      }),
    });
    expect(notifications.sendOverdueLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'PAYMENT_AUTHENTICATION_REQUIRED',
        actionUrl: 'https://invoice.stripe.test/authenticate',
      }),
    );
  });

  it('does not suspend service before Stripe reaches its scheduled retry', async () => {
    const now = new Date('2026-09-29T00:00:00.000Z');
    const transaction = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          status: SubscriptionStatus.PAST_DUE,
          billingMode: BillingMode.STRIPE_RECURRING,
          gracePeriodEndsAt: new Date('2026-09-28T00:00:00.000Z'),
          customer: paidInvoice.customer,
          plan: { name: 'Home 100' },
          invoices: [
            {
              ...paidInvoice,
              status: InvoiceStatus.OVERDUE,
              stripeNextPaymentAttempt: new Date('2026-09-30T00:00:00.000Z'),
            },
          ],
        }),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      subscription: { findMany: jest.fn().mockResolvedValue([{ id: 'subscription-id' }]) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue({
        gracePeriodDays: 7,
        terminationDays: 30,
        batchSize: 50,
      }),
    };
    const service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.suspendExpiredGracePeriods(now)).resolves.toBe(0);
    expect(transaction.subscription.updateMany).not.toHaveBeenCalled();
  });
});
