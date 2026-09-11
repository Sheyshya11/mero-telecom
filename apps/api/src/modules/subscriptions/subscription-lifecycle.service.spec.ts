import { InvoiceStatus, SubscriptionStatus, SuspensionReason } from '@prisma/client';

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
});
