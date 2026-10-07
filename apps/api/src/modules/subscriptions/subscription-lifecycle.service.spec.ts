import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

function setup(dueDate: Date) {
  const invoice = {
    id: 'invoice',
    customerId: 'customer',
    invoiceNumber: 'INV',
    totalCents: 7990,
    currency: 'AUD',
    dueDate,
    status: InvoiceStatus.ISSUED,
    stripeAttemptCount: 0,
    customer: { firstName: 'Test', lastName: 'Customer', email: 'test@example.test' },
    subscription: {
      id: 'subscription',
      status: SubscriptionStatus.ACTIVE,
      gracePeriodEndsAt: null,
      suspendedAt: null,
    },
  };
  const tx = {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(invoice),
      update: jest.fn().mockResolvedValue(invoice),
    },
    paymentWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}), upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (work: (database: typeof tx) => unknown) => work(tx)),
  };
  const config = {
    getOrThrow: jest
      .fn()
      .mockReturnValue({ gracePeriodDays: 7, terminationDays: 30, batchSize: 50 }),
  };
  const notifications = { sendOverdueLifecycleNotification: jest.fn().mockResolvedValue({}) };
  const provisioning = { reconcilePending: jest.fn().mockResolvedValue(0) };
  const collections = {
    markOverdue: jest.fn().mockResolvedValue(1),
    warnings: jest.fn().mockResolvedValue(2),
    suspend: jest.fn().mockResolvedValue(3),
    confirmedPayment: jest.fn().mockResolvedValue(undefined),
    deliver: jest.fn().mockResolvedValue(0),
  };
  const service = new SubscriptionLifecycleService(
    prisma as never,
    config as never,
    {} as never,
    provisioning as never,
    notifications as never,
    { invalidate: jest.fn() } as never,
    undefined,
    collections as never,
  );
  return { service, tx, collections, provisioning, notifications, invoice };
}
describe('SubscriptionLifecycleService collection integration', () => {
  it('does not mark a future invoice overdue or suspend after a failed automatic payment', async () => {
    const { service, tx, notifications } = setup(new Date('2100-01-01'));
    await service.handlePaymentFailure({
      invoiceId: 'invoice',
      providerEventId: 'evt-failed',
      eventType: 'invoice.payment_failed',
    });
    expect(tx.invoice.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: InvoiceStatus.OVERDUE }) }),
    );
    expect(notifications.sendOverdueLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PAYMENT_FAILED' }),
    );
  });
  it('keeps failed-payment collection separate from service state even when overdue', async () => {
    const { service, tx } = setup(new Date('2020-01-01'));
    await service.handlePaymentFailure({
      invoiceId: 'invoice',
      providerEventId: 'evt-failed',
      eventType: 'invoice.payment_failed',
    });
    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: InvoiceStatus.OVERDUE }) }),
    );
  });
  it('reconciles a pending recurring invoice placeholder after its payment intent fails', async () => {
    const { service, tx, invoice } = setup(new Date('2020-01-01'));
    Object.assign(invoice, { stripeInvoiceId: 'in_recurring' });
    tx.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'payment',
      status: 'PENDING',
      providerPaymentId: 'stripe-invoice:in_recurring',
    } as never);
    await service.handlePaymentFailure({
      invoiceId: invoice.id,
      providerEventId: 'evt-intent-failed',
      eventType: 'invoice.payment_failed',
      providerPaymentId: 'pi_failed',
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment' },
      data: { status: 'FAILED', providerPaymentId: 'pi_failed' },
    });
  });
  it('does not clear an unrelated processing payment for an invoice-level failure without an intent', async () => {
    const { service, tx } = setup(new Date('2020-01-01'));
    tx.payment.findFirst.mockResolvedValueOnce({
      id: 'payment',
      status: 'PROCESSING',
      providerPaymentId: 'pi_processing',
    } as never);
    await service.handlePaymentFailure({
      invoiceId: 'invoice',
      providerEventId: 'evt-invoice-failed',
      eventType: 'invoice.payment_failed',
    });
    expect(tx.payment.update).not.toHaveBeenCalled();
  });
  it('delegates scheduler phases and payment success to the existing collection integration', async () => {
    const { service, collections, provisioning } = setup(new Date('2020-01-01'));
    await expect(service.markDueInvoicesOverdue()).resolves.toBe(1);
    await expect(service.processNotifications()).resolves.toBe(2);
    await expect(service.suspendExpiredGracePeriods()).resolves.toBe(3);
    await service.handleConfirmedPayment('invoice');
    expect(collections.confirmedPayment).toHaveBeenCalledWith('invoice');
    expect(provisioning.reconcilePending).toHaveBeenCalledWith(50);
  });
});
