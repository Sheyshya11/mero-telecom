import {
  AccountCreditClassification,
  AccountTransactionReason,
  AccountTransactionStatus,
  AccountTransactionType,
  BillingMode,
  CancellationStatus,
  PaymentStatus,
  Prisma,
  Role,
  ServiceRelocationStatus,
  StripeSyncStatus,
  SubscriptionStatus,
} from '@prisma/client';

import { AccountLedgerService } from './account-ledger.service';

const customerId = '46ed2dc1-1ff8-4649-8440-1aa4355b97ad';
const subscriptionId = '06391a83-f79a-4cc7-9e3f-31f9c41f3b9d';
const invoiceId = '6b34d995-21a6-4d36-8e28-1f465f93cc66';
const actor = { id: 'f54bf89d-7f83-427d-9152-95301cbacff5', role: Role.SUPER_ADMIN } as never;

function serviceWith(prisma: object, createBalanceTransaction = jest.fn()) {
  return {
    createBalanceTransaction,
    service: new AccountLedgerService(
      prisma as never,
      {
        client: { customers: { createBalanceTransaction } },
      } as never,
    ),
  };
}

function createTransactionHarness(overrides: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  const transaction = {
    accountTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `adjustment-${created.length + 1}`,
          status: AccountTransactionStatus.PENDING,
          stripeSyncStatus: StripeSyncStatus.NOT_REQUIRED,
          applications: [],
          ...data,
        };
        created.push(row);
        return row;
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    customer: { findUnique: jest.fn().mockResolvedValue({ id: customerId }) },
    subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    invoice: { findFirst: jest.fn().mockResolvedValue({ id: invoiceId, customerId }) },
    cancellationRequest: { findFirst: jest.fn() },
    serviceRelocation: { findFirst: jest.fn() },
    payment: { findFirst: jest.fn() },
    $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
    ...overrides,
  };
  return { created, prisma, transaction };
}

describe('AccountLedgerService', () => {
  it('calculates and records a billing-correction credit in integer cents', async () => {
    const harness = createTransactionHarness();
    const { service } = serviceWith(harness.prisma);

    await service.create(
      {
        customerId,
        invoiceId,
        type: AccountTransactionType.CREDIT,
        reason: AccountTransactionReason.BILLING_CORRECTION,
        creditClassification: AccountCreditClassification.REFUNDABLE,
        description: 'Corrected an incorrect eligible service charge',
        calculation: {
          incorrectEligibleChargeCents: 10_000,
          correctEligibleChargeCents: 9_000,
        },
      },
      actor,
    );

    expect(harness.transaction.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 1_000,
          suggestedAmountCents: 1_000,
          remainingAmountCents: 1_000,
          sourceType: 'INVOICE',
          sourceId: invoiceId,
          deduplicationKey: expect.stringContaining(invoiceId),
        }),
      }),
    );
  });

  it('requires a unique outage reference and a source for debit adjustments', async () => {
    const { service } = serviceWith(createTransactionHarness().prisma);
    await expect(
      service.create(
        {
          customerId,
          type: AccountTransactionType.CREDIT,
          reason: AccountTransactionReason.SERVICE_OUTAGE,
          creditClassification: AccountCreditClassification.SERVICE_ONLY,
          amountCents: 1_000,
          description: 'Outage compensation',
        },
        actor,
      ),
    ).rejects.toThrow('unique fault or outage reference');
    await expect(
      service.create(
        {
          customerId,
          type: AccountTransactionType.DEBIT,
          reason: AccountTransactionReason.EQUIPMENT_CHARGE,
          amountCents: 5_000,
          description: 'Router replacement',
        },
        actor,
      ),
    ).rejects.toThrow('source reference');
  });

  it('rejects credit-only reasons on debits and derives a stable source key', async () => {
    const harness = createTransactionHarness();
    const { service } = serviceWith(harness.prisma);
    await expect(
      service.create(
        {
          customerId,
          type: AccountTransactionType.DEBIT,
          reason: AccountTransactionReason.GOODWILL,
          amountCents: 500,
          sourceId: 'case-1',
          description: 'Invalid debit',
        },
        actor,
      ),
    ).rejects.toThrow('not a valid debit reason');

    await service.create(
      {
        customerId,
        type: AccountTransactionType.CREDIT,
        reason: AccountTransactionReason.SERVICE_OUTAGE,
        creditClassification: AccountCreditClassification.SERVICE_ONLY,
        amountCents: 500,
        sourceId: 'fault-123',
        description: 'Outage compensation',
      },
      actor,
    );
    expect(harness.transaction.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: AccountTransactionReason.SERVICE_OUTAGE,
          deduplicationKey: 'credit:service_outage:service_outage:fault-123',
        }),
      }),
    );
  });

  it('calculates overpayment only from a succeeded supported payment', async () => {
    const harness = createTransactionHarness({
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          invoiceId,
          amountCents: 10_000,
          status: PaymentStatus.SUCCEEDED,
          invoice: { id: invoiceId, totalCents: 7_900, subscriptionId },
        }),
      },
    });
    const { service } = serviceWith(harness.prisma);

    await service.create(
      {
        customerId,
        type: AccountTransactionType.CREDIT,
        reason: AccountTransactionReason.OVERPAYMENT,
        creditClassification: AccountCreditClassification.REFUNDABLE,
        sourceId: 'payment-1',
        description: 'Supported payment overpayment',
      },
      actor,
    );

    expect(harness.transaction.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 2_100,
          sourceType: 'PAYMENT',
          sourceId: 'payment-1',
        }),
      }),
    );
  });

  it('creates a cancellation credit from the completed workflow calculation', async () => {
    const harness = createTransactionHarness({
      cancellationRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cancellation-1',
          customerId,
          subscriptionId,
          status: CancellationStatus.COMPLETED,
          refund: null,
          refundAmountCents: 2_548,
          refundCalculation: { unusedDays: 10, billingDays: 31 },
          effectiveAt: new Date('2026-10-21T00:00:00.000Z'),
        }),
      },
    });
    const { service } = serviceWith(harness.prisma);

    await service.create(
      {
        customerId,
        type: AccountTransactionType.CREDIT,
        reason: AccountTransactionReason.CANCELLATION_UNUSED_SERVICE,
        creditClassification: AccountCreditClassification.REFUNDABLE,
        sourceId: 'cancellation-1',
        description: 'Unused prepaid service',
      },
      actor,
    );

    expect(harness.transaction.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 2_548,
          sourceType: 'CANCELLATION_REQUEST',
          sourceId: 'cancellation-1',
          deduplicationKey: 'credit:cancellation:cancellation-1',
        }),
      }),
    );
  });

  it('uses confirmed relocation dates and excludes both service endpoint days', async () => {
    const periodStart = new Date('2026-10-01T00:00:00.000Z');
    const periodEnd = new Date('2026-11-01T00:00:00.000Z');
    const harness = createTransactionHarness({
      serviceRelocation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'relocation-1',
          status: ServiceRelocationStatus.COMPLETED,
          subscriptionId,
          oldServiceDisconnectedAt: new Date('2026-10-10T00:00:00.000Z'),
          newServiceActivatedAt: new Date('2026-10-15T00:00:00.000Z'),
          subscription: {
            monthlyCents: 7_900,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          },
        }),
      },
    });
    const { service } = serviceWith(harness.prisma);

    await service.create(
      {
        customerId,
        type: AccountTransactionType.CREDIT,
        reason: AccountTransactionReason.RELOCATION_SERVICE_GAP,
        creditClassification: AccountCreditClassification.SERVICE_ONLY,
        sourceId: 'relocation-1',
        description: 'Confirmed no-service gap',
      },
      actor,
    );

    expect(harness.transaction.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountCents: 1_019, sourceType: 'SERVICE_RELOCATION' }),
      }),
    );
  });

  it('maps a duplicate source constraint to a safe business conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    const harness = createTransactionHarness({
      $transaction: jest.fn().mockRejectedValue(duplicate),
    });
    const { service } = serviceWith(harness.prisma);

    await expect(
      service.create(
        {
          customerId,
          type: AccountTransactionType.CREDIT,
          reason: AccountTransactionReason.GOODWILL,
          creditClassification: AccountCreditClassification.SERVICE_ONLY,
          amountCents: 500,
          description: 'Goodwill credit',
        },
        actor,
      ),
    ).rejects.toThrow('already been recorded');
  });

  it('approves a manual credit with a reviewed amount and approval note', async () => {
    const current = {
      id: 'credit-1',
      customerId,
      subscriptionId,
      type: AccountTransactionType.CREDIT,
      amountCents: 2_000,
      suggestedAmountCents: 2_000,
      status: AccountTransactionStatus.PENDING,
    };
    const transaction = {
      $queryRaw: jest.fn(),
      accountTransaction: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...current,
          ...data,
        })),
      },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const { service } = serviceWith(prisma);

    const result = await service.approve(
      'credit-1',
      { approvedAmountCents: 1_500, approvalNote: 'Approved after outage review' },
      actor,
    );

    expect(result).toMatchObject({
      amountCents: 1_500,
      remainingAmountCents: 1_500,
      approvalNote: 'Approved after outage review',
      status: AccountTransactionStatus.AVAILABLE,
    });
  });

  it('synchronizes a recurring credit once with a stable Stripe idempotency key', async () => {
    let record = {
      id: 'credit-1',
      customerId,
      customer: { stripeCustomerId: 'cus_123' },
      type: AccountTransactionType.CREDIT,
      reason: AccountTransactionReason.SERVICE_OUTAGE,
      amountCents: 2_000,
      currency: 'AUD',
      description: 'Outage credit',
      stripeSyncStatus: StripeSyncStatus.FAILED,
    };
    const transaction = {
      accountTransaction: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          record = { ...record, ...data } as typeof record;
          return record;
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      accountTransaction: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(record)),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          record = { ...record, ...data } as typeof record;
          return record;
        }),
      },
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const createBalanceTransaction = jest.fn().mockResolvedValue({ id: 'cbtxn_123' });
    const { service } = serviceWith(prisma, createBalanceTransaction);

    await service.retryStripeSync('credit-1');
    await expect(service.retryStripeSync('credit-1')).rejects.toThrow(
      'does not require a Stripe synchronization retry',
    );

    expect(createBalanceTransaction).toHaveBeenCalledTimes(1);
    expect(createBalanceTransaction).toHaveBeenCalledWith(
      'cus_123',
      expect.objectContaining({ amount: -2_000, currency: 'aud' }),
      { idempotencyKey: 'account-transaction-credit-1' },
    );
  });

  it('records a failed Stripe synchronization without making the credit available', async () => {
    const record = {
      id: 'credit-1',
      customerId,
      customer: { stripeCustomerId: 'cus_123' },
      type: AccountTransactionType.CREDIT,
      reason: AccountTransactionReason.GOODWILL,
      amountCents: 500,
      currency: 'AUD',
      description: 'Goodwill',
      stripeSyncStatus: StripeSyncStatus.FAILED,
    };
    const updates: Record<string, unknown>[] = [];
    const transaction = {
      accountTransaction: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { ...record, ...data };
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      accountTransaction: {
        findUnique: jest.fn().mockResolvedValue(record),
        update: transaction.accountTransaction.update,
      },
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const { service } = serviceWith(
      prisma,
      jest.fn().mockRejectedValue(new Error('temporary Stripe outage')),
    );

    const result = await service.retryStripeSync('credit-1');

    expect(result).toMatchObject({ stripeSyncStatus: StripeSyncStatus.FAILED });
    expect(updates).toContainEqual(
      expect.objectContaining({
        stripeSyncStatus: StripeSyncStatus.FAILED,
        stripeSyncFailureReason: 'temporary Stripe outage',
      }),
    );
    expect(updates).not.toContainEqual(
      expect.objectContaining({ status: AccountTransactionStatus.AVAILABLE }),
    );
  });

  it('applies multiple manual credits FIFO, supports partial use, and never exceeds the invoice', async () => {
    const applications: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const transaction = {
      $executeRaw: jest.fn(),
      creditApplication: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          applications.push(data);
          return data;
        }),
      },
      accountTransaction: {
        findMany: jest.fn(({ where }: { where: { type: AccountTransactionType } }) =>
          Promise.resolve(
            where.type === AccountTransactionType.CREDIT
              ? [
                  { id: 'credit-1', remainingAmountCents: 6_000 },
                  { id: 'credit-2', remainingAmountCents: 5_000 },
                ]
              : [],
          ),
        ),
        update: jest.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            updates.push({ id: where.id, ...data });
            return data;
          },
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({});

    const result = await service.applyManualInvoiceAdjustments(transaction as never, {
      customerId,
      subscriptionId,
      invoiceId,
      baseAmountCents: 7_900,
    });

    expect(result).toEqual({ creditAppliedCents: 7_900, debitAppliedCents: 0 });
    expect(applications.map((row) => row.amountCents)).toEqual([6_000, 1_900]);
    expect(updates).toEqual([
      expect.objectContaining({ id: 'credit-1', remainingAmountCents: 0, status: 'USED' }),
      expect.objectContaining({
        id: 'credit-2',
        remainingAmountCents: 3_100,
        status: 'PARTIALLY_USED',
      }),
    ]);
  });

  it('applies manual debits before credits so the net invoice remains deterministic', async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      creditApplication: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } }),
        create: jest.fn().mockResolvedValue({}),
      },
      accountTransaction: {
        findMany: jest.fn(({ where }: { where: { type: AccountTransactionType } }) =>
          Promise.resolve(
            where.type === AccountTransactionType.DEBIT
              ? [{ id: 'debit-1', remainingAmountCents: 2_000 }]
              : [{ id: 'credit-1', remainingAmountCents: 10_000 }],
          ),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = serviceWith({});

    await expect(
      service.applyManualInvoiceAdjustments(transaction as never, {
        customerId,
        subscriptionId,
        invoiceId,
        baseAmountCents: 7_900,
      }),
    ).resolves.toEqual({ creditAppliedCents: 9_900, debitAppliedCents: 2_000 });
  });

  it('does not duplicate a Stripe invoice application already recorded', async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      creditApplication: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 2_000 } }),
        create: jest.fn(),
      },
      accountTransaction: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const { service } = serviceWith({});

    await expect(
      service.recordStripeInvoiceApplication(transaction as never, {
        customerId,
        invoiceId,
        stripeInvoiceId: 'in_123',
        creditAppliedCents: 2_000,
      }),
    ).resolves.toEqual({ allocatedCents: 0, unallocatedCents: 0 });
    expect(transaction.creditApplication.create).not.toHaveBeenCalled();
  });

  it('reverses only an unused remainder with a compensating transaction', async () => {
    const current = {
      id: 'credit-1',
      customerId,
      subscriptionId,
      invoiceId: null,
      type: AccountTransactionType.CREDIT,
      amountCents: 2_000,
      remainingAmountCents: 750,
      status: AccountTransactionStatus.PARTIALLY_USED,
      stripeSyncStatus: StripeSyncStatus.NOT_REQUIRED,
    };
    const transaction = {
      $queryRaw: jest.fn(),
      accountTransaction: {
        findUnique: jest.fn().mockResolvedValue(current),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'debit-reversal',
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const { service } = serviceWith(prisma);

    const result = await service.reverse(
      'credit-1',
      { description: 'Reverse remaining incorrect credit' },
      actor,
    );

    expect(result).toMatchObject({
      type: AccountTransactionType.DEBIT,
      amountCents: 750,
      remainingAmountCents: 750,
      reversesTransactionId: 'credit-1',
    });
    expect(transaction.accountTransaction.update).toHaveBeenCalledWith({
      where: { id: 'credit-1' },
      data: expect.objectContaining({
        remainingAmountCents: 0,
        status: AccountTransactionStatus.REVERSED,
      }),
    });
  });

  it('returns customer credit history without internal notes or Stripe identifiers', async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: customerId }) },
      accountTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'credit-1',
            reason: AccountTransactionReason.GOODWILL,
            description: 'Service goodwill',
            amountCents: 1_000,
            remainingAmountCents: 0,
            currency: 'AUD',
            status: AccountTransactionStatus.USED,
            creditClassification: AccountCreditClassification.SERVICE_ONLY,
            createdAt: new Date('2026-09-15T00:00:00.000Z'),
            internalNote: 'private',
            stripeBalanceTransactionId: 'cbtxn_private',
            applications: [
              {
                id: 'application-1',
                amountCents: 1_000,
                createdAt: new Date('2026-10-01T00:00:00.000Z'),
                invoice: { invoiceNumber: 'INV-1045' },
              },
            ],
          },
        ]),
      },
    };
    const { service } = serviceWith(prisma);

    const result = await service.findMine({ id: 'customer-user' } as never);
    const serialized = JSON.stringify(result);

    expect(serialized).toContain('INV-1045');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('cbtxn_private');
  });

  it('calculates the next amount from available credits and pending debits', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: customerId,
          subscriptions: [
            {
              billingMode: BillingMode.STRIPE_RECURRING,
              status: SubscriptionStatus.ACTIVE,
              monthlyCents: 7_900,
              nextBillingAt: new Date('2026-10-28T00:00:00.000Z'),
              paymentMethodType: 'CARD',
              paymentMethodBrand: 'visa',
              paymentMethodLast4: '4242',
            },
          ],
          invoices: [{ totalCents: 5_900 }],
        }),
      },
      accountTransaction: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { remainingAmountCents: 2_000 } })
          .mockResolvedValueOnce({ _sum: { remainingAmountCents: 1_000 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(service.financeSummary(customerId)).resolves.toMatchObject({
      availableCreditCents: 2_000,
      pendingDebitCents: 1_000,
      outstandingCents: 5_900,
      estimatedNextAmountCents: 6_900,
    });
  });
});
