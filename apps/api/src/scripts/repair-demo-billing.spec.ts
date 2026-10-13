import { PrismaClient } from '@prisma/client';

import { assertLocalDemoRepair, repairDemoBilling } from './repair-demo-billing';

const now = new Date('2026-10-12T00:00:00Z');
function fixture(overrides: Record<string, unknown> = {}) {
  const quote = {
    id: 'quote-id',
    status: 'PENDING',
    currentPeriodEndSnapshot: new Date('2026-10-01T00:00:00Z'),
    invoiceId: 'quote-invoice',
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    paymentId: null,
    invoice: {
      type: 'PLAN_CHANGE',
      status: 'ISSUED',
      paidAt: null,
      stripeInvoiceId: null,
      payments: [],
    },
  };
  const subscription = {
    id: 'subscription-id',
    status: 'ACTIVE',
    billingMode: 'MANUAL',
    billingCycle: 'MONTHLY',
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    billingAnchorDay: 1,
    currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
    sourcePlanChanges: [quote],
    ...overrides,
  };
  const tx = {
    $queryRaw: jest.fn(),
    customer: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'demo-id' }) },
    subscription: {
      findMany: jest.fn().mockResolvedValue([subscription]),
      findUniqueOrThrow: jest.fn().mockResolvedValue(subscription),
      update: jest.fn(),
    },
    planChangeRequest: { update: jest.fn() },
    invoice: { count: jest.fn().mockResolvedValue(0), update: jest.fn() },
    cancellationRequest: { count: jest.fn().mockResolvedValue(0) },
    serviceRelocation: { count: jest.fn().mockResolvedValue(0) },
    recurringSetupAttempt: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
  return { tx, quote, subscription, prisma: prisma as unknown as PrismaClient };
}

describe('local demo billing repair', () => {
  it.each([
    ['production', 'postgresql://localhost/demo'],
    ['development', 'postgresql://remote.example/demo'],
    [undefined, 'postgresql://localhost/demo'],
  ])('rejects environment %s and database %s', (environment, url) => {
    expect(() => assertLocalDemoRepair(environment, url)).toThrow();
  });
  it('accepts only an explicitly nonproduction local database', () => {
    expect(() => assertLocalDemoRepair('development', 'postgresql://127.0.0.1/demo')).not.toThrow();
  });
  it('previews new dates and expired quotes without changing records', async () => {
    const f = fixture();
    await expect(repairDemoBilling(f.prisma, false, now)).resolves.toMatchObject({
      applied: false,
      after: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' },
      expiredQuoteIds: ['quote-id'],
      cancelledInvoiceIds: ['quote-invoice'],
    });
    expect(f.tx.customer.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { email: 'customer@merotelecom.test' },
    });
    expect(f.tx.subscription.update).not.toHaveBeenCalled();
    expect(f.tx.invoice.update).not.toHaveBeenCalled();
  });
  it('updates only dates and the unsubmitted quote, retaining an audit record', async () => {
    const f = fixture();
    await repairDemoBilling(f.prisma, true, now);
    expect(f.tx.subscription.update).toHaveBeenCalledWith({
      where: { id: 'subscription-id' },
      data: {
        currentPeriodStart: new Date('2026-10-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
      },
    });
    expect(f.tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'quote-invoice' },
      data: { status: 'CANCELLED' },
    });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DEMO_BILLING_PERIOD_REFRESHED' }),
      }),
    );
  });
  it('is a no-op for a current billing period', async () => {
    const f = fixture({ currentPeriodEnd: new Date('2026-11-01T00:00:00Z') });
    await expect(repairDemoBilling(f.prisma, true, now)).resolves.toEqual({
      changed: false,
      subscriptionId: 'subscription-id',
    });
    expect(f.tx.subscription.update).not.toHaveBeenCalled();
  });
  it.each(['stripeCheckoutSessionId', 'stripePaymentIntentId', 'paymentId'])(
    'refuses a quote with %s',
    async (field) => {
      const f = fixture();
      Reflect.set(f.quote, field, 'provider-backed-id');
      await expect(repairDemoBilling(f.prisma, true, now)).rejects.toThrow('reconciliation');
      expect(f.tx.subscription.update).not.toHaveBeenCalled();
    },
  );
  it('refuses a paid quote invoice', async () => {
    const f = fixture();
    f.quote.invoice.status = 'PAID';
    await expect(repairDemoBilling(f.prisma, true, now)).rejects.toThrow('reconciliation');
    expect(f.tx.invoice.update).not.toHaveBeenCalled();
  });
  it('refuses unrelated unpaid invoices', async () => {
    const f = fixture();
    f.tx.invoice.count.mockResolvedValue(1);
    await expect(repairDemoBilling(f.prisma, true, now)).rejects.toThrow('Outstanding billing');
    expect(f.tx.subscription.update).not.toHaveBeenCalled();
  });
});
