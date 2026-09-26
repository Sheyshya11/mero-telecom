import { InvoiceStatus, Prisma, SubscriptionStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from './invoices.service';

const subscription = {
  id: 'subscription-id',
  customerId: 'customer-id',
  status: SubscriptionStatus.ACTIVE,
  monthlyCents: 6900,
  plan: { name: 'Essential 50', monthlyCents: 7900 },
  customer: {},
};

const octoberPeriod = {
  start: new Date('2026-10-01T00:00:00.000Z'),
  end: new Date('2026-10-31T00:00:00.000Z'),
};

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-id',
    invoiceNumber: 'INV-2026-000001',
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    purchasePlanId: null,
    issueDate: new Date('2026-10-01T00:00:00.000Z'),
    dueDate: new Date('2026-10-15T00:00:00.000Z'),
    billingPeriodStart: octoberPeriod.start,
    billingPeriodEnd: octoberPeriod.end,
    subtotalCents: 6273,
    taxCents: 627,
    totalCents: 6900,
    currency: 'AUD',
    status: InvoiceStatus.ISSUED,
    customer: {},
    subscription: { plan: subscription.plan },
    items: [],
    payments: [],
    ...overrides,
  };
}

function serviceWith(prisma: object) {
  return new InvoicesService(
    prisma as PrismaService,
    new BillingService(),
    {} as never,
    { invalidate: jest.fn().mockResolvedValue(true) } as never,
  );
}

function successfulTransaction(created = invoice()) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
    invoice: {
      findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      create: jest.fn().mockResolvedValue(created),
    },
  };
}

describe('InvoicesService billing-period idempotency', () => {
  it('generates the first standard invoice for a billing period', async () => {
    const createdInvoice = invoice();
    const transaction = successfulTransaction(createdInvoice);
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await expect(
      serviceWith(prisma).generate({
        subscriptionId: subscription.id,
        issueDate: '2026-10-19',
      }),
    ).resolves.toEqual({ ...createdInvoice, generationResult: 'CREATED' });

    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subscriptionId: subscription.id,
          billingPeriodStart: octoberPeriod.start,
          billingPeriodEnd: octoberPeriod.end,
          subtotalCents: 6273,
          taxCents: 627,
          totalCents: 6900,
          status: InvoiceStatus.ISSUED,
        }),
      }),
    );
  });

  it.each([
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PAID,
    InvoiceStatus.OVERDUE,
    InvoiceStatus.CANCELLED,
  ])('returns the existing %s invoice instead of creating another', async (status) => {
    const existing = invoice({ status });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await expect(
      serviceWith(prisma).generate({
        subscriptionId: subscription.id,
        issueDate: '2026-10-25',
      }),
    ).resolves.toEqual({ ...existing, generationResult: 'EXISTING' });
    expect(transaction.invoice.create).not.toHaveBeenCalled();
  });

  it('uses the subscription price snapshot after the catalogue price changes', async () => {
    const transaction = successfulTransaction(invoice());
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await serviceWith(prisma).generate({
      subscriptionId: subscription.id,
      issueDate: '2026-10-01',
    });

    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalCents: 6900 }),
      }),
    );
  });

  it('allows the next billing period for the same subscription', async () => {
    const transaction = successfulTransaction(
      invoice({
        id: 'november-invoice',
        issueDate: new Date('2026-11-01T00:00:00.000Z'),
        billingPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
        billingPeriodEnd: new Date('2026-11-30T00:00:00.000Z'),
      }),
    );
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await serviceWith(prisma).generate({
      subscriptionId: subscription.id,
      issueDate: '2026-11-10',
    });

    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
          billingPeriodEnd: new Date('2026-11-30T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('allows another subscription to use the same billing period', async () => {
    const otherSubscription = { ...subscription, id: 'other-subscription-id' };
    const transaction = successfulTransaction(invoice({ subscriptionId: otherSubscription.id }));
    transaction.subscription.findUnique.mockResolvedValue(otherSubscription);
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await serviceWith(prisma).generate({
      subscriptionId: otherSubscription.id,
      issueDate: '2026-10-01',
    });

    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subscriptionId: otherSubscription.id }),
      }),
    );
  });

  it('returns the persisted invoice when concurrent creation hits the unique constraint', async () => {
    const persisted = invoice();
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['subscriptionId', 'billingPeriodStart', 'billingPeriodEnd'] },
    });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
      invoice: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: jest.fn().mockRejectedValue(uniqueError),
      },
    };
    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(persisted) },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    await expect(
      serviceWith(prisma).generate({
        subscriptionId: subscription.id,
        issueDate: '2026-10-01',
      }),
    ).resolves.toEqual({ ...persisted, generationResult: 'EXISTING' });
  });

  it('persists one invoice when manual and automated callers generate concurrently', async () => {
    let persisted: ReturnType<typeof invoice> | null = null;
    let persistedCount = 0;
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: { findUnique: jest.fn().mockResolvedValue(subscription) },
      invoice: {
        findFirst: jest.fn(async (args: { where: Record<string, unknown> }) =>
          'subscriptionId' in args.where ? persisted : null,
        ),
        create: jest.fn(async () => {
          if (persisted) throw uniqueError;
          persisted = invoice();
          persistedCount += 1;
          return persisted;
        }),
      },
    };
    const prisma = {
      invoice: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(persisted)) },
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };
    const service = serviceWith(prisma);

    const [manual, automated] = await Promise.all([
      service.generate({ subscriptionId: subscription.id, issueDate: '2026-10-01' }),
      service.generateForBillingPeriod(subscription.id, new Date('2026-10-20T00:00:00.000Z')),
    ]);

    expect([manual.generationResult, automated.generationResult].sort()).toEqual([
      'CREATED',
      'EXISTING',
    ]);
    expect(persistedCount).toBe(1);
    expect(persisted).not.toBeNull();
  });

  it('does not expose a raw Prisma error when a unique conflict cannot be resolved', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Sensitive database details', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const prisma = {
      invoice: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockRejectedValue(uniqueError),
    };

    await expect(
      serviceWith(prisma).generate({
        subscriptionId: subscription.id,
        issueDate: '2026-10-01',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INVOICE_GENERATION_CONFLICT',
        message: 'The invoice could not be generated because another invoice was created.',
      },
    });
  });

  it('finds legacy monthly invoices that predate canonical period fields', async () => {
    const legacy = invoice({ billingPeriodStart: null, billingPeriodEnd: null });
    const prisma = { invoice: { findFirst: jest.fn().mockResolvedValue(legacy) } };

    await expect(
      serviceWith(prisma).findForBillingPeriod(subscription.id, '2026-10-12'),
    ).resolves.toBe(legacy);

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subscriptionId: subscription.id }),
      }),
    );
  });
});
