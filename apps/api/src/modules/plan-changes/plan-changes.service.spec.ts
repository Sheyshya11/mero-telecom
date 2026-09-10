import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BillingCycle,
  PlanChangeStatus,
  PlanChangeType,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { PlanChangesService } from './plan-changes.service';

const actor: AuthenticatedUser = {
  id: '31aaa425-3762-4698-af27-abf5db806af5',
  email: 'customer@example.com',
  role: Role.CUSTOMER,
};
const subscriptionId = '7728f6e3-8554-4777-88df-084374436e88';
const customerId = '88776906-3dc9-4988-aa9c-1929ac70d55b';
const sourcePlan = {
  id: '7a9e433e-57dc-4d7f-a40e-90a83ff8c10a',
  name: 'Essential 50',
  description: null,
  downloadMbps: 50,
  uploadMbps: 20,
  monthlyCents: 6900,
  isActive: true,
  isPublic: true,
  isAvailable: true,
  tierRank: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const targetPlan = {
  ...sourcePlan,
  id: 'a28ca77d-dd35-4291-9eb8-0439b55692a3',
  name: 'Family 100',
  monthlyCents: 9900,
  tierRank: 2,
};
const sourceSubscription = {
  id: subscriptionId,
  customerId,
  planId: sourcePlan.id,
  status: SubscriptionStatus.ACTIVE,
  startDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: null,
  endReason: null,
  billingCycle: BillingCycle.MONTHLY,
  billingAnchorDay: 1,
  currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
  plan: sourcePlan,
  customer: { id: customerId },
};

function previewTransaction(
  overrides: {
    subscription?: typeof sourceSubscription | null;
    target?: typeof targetPlan | null;
    blockingInvoices?: number;
    pendingChanges?: number;
  } = {},
) {
  return {
    subscription: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.subscription === undefined ? sourceSubscription : overrides.subscription,
        ),
    },
    internetPlan: {
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides.target === undefined ? targetPlan : overrides.target),
    },
    invoice: { count: jest.fn().mockResolvedValue(overrides.blockingInvoices ?? 0) },
    planChangeRequest: { count: jest.fn().mockResolvedValue(overrides.pendingChanges ?? 0) },
    cancellationRequest: { count: jest.fn().mockResolvedValue(0) },
  };
}

function makeService(
  transaction: object,
  prismaOverrides: object = {},
  stripeClient: object = { client: {} },
) {
  const prisma = {
    $transaction: jest.fn((operation: (client: object) => unknown) => operation(transaction)),
    ...prismaOverrides,
  };
  const notifications = { sendPlanChangeNotification: jest.fn().mockResolvedValue({}) };
  const service = new PlanChangesService(
    prisma as unknown as PrismaService,
    new BillingService(),
    {
      getOrThrow: jest.fn((key: string) =>
        key === 'app' ? { frontendUrl: 'http://localhost:3000' } : {},
      ),
    } as never,
    stripeClient as never,
    notifications as never,
    { invalidate: jest.fn().mockResolvedValue(true) } as never,
  );
  return { notifications, prisma, service };
}

describe('PlanChangesService', () => {
  it('returns a server-authoritative upgrade preview', async () => {
    const { service } = makeService(previewTransaction());
    await expect(
      service.preview(subscriptionId, targetPlan.id, actor, new Date('2026-08-16T12:00:00.000Z')),
    ).resolves.toEqual(
      expect.objectContaining({
        type: PlanChangeType.UPGRADE,
        currentPlanPriceCents: 6900,
        targetPlanPriceCents: 9900,
        unusedCreditCents: 3450,
        proratedTargetCents: 4950,
        amountPayableCents: 1500,
        currency: 'AUD',
      }),
    );
  });

  it('detects a downgrade and schedules it at the exact period boundary', async () => {
    const cheaperPlan = { ...targetPlan, monthlyCents: 4900 };
    const { service } = makeService(previewTransaction({ target: cheaperPlan }));
    await expect(
      service.preview(subscriptionId, cheaperPlan.id, actor, new Date('2026-08-16T12:00:00.000Z')),
    ).resolves.toEqual(
      expect.objectContaining({
        type: PlanChangeType.DOWNGRADE,
        amountPayableCents: 0,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );
  });

  it.each([
    [
      'a suspended source subscription',
      previewTransaction({
        subscription: { ...sourceSubscription, status: SubscriptionStatus.SUSPENDED },
      }),
      BadRequestException,
    ],
    [
      'an inactive target plan',
      previewTransaction({ target: { ...targetPlan, isActive: false } }),
      BadRequestException,
    ],
    ['an outstanding invoice', previewTransaction({ blockingInvoices: 1 }), ConflictException],
    ['an existing pending change', previewTransaction({ pendingChanges: 1 }), ConflictException],
    [
      'a subscription owned by another customer',
      previewTransaction({ subscription: null }),
      NotFoundException,
    ],
  ])('rejects %s', async (_label, transaction, expectedError) => {
    const { service } = makeService(transaction);
    await expect(
      service.preview(subscriptionId, targetPlan.id, actor, new Date('2026-08-16T12:00:00.000Z')),
    ).rejects.toBeInstanceOf(expectedError);
  });

  it('rejects selecting the source plan', async () => {
    const { service } = makeService(previewTransaction());
    await expect(
      service.preview(subscriptionId, sourcePlan.id, actor, new Date('2026-08-16T12:00:00.000Z')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a scheduled downgrade and queues its confirmation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
    const cheaperPlan = { ...targetPlan, monthlyCents: 4900 };
    const request = planChangeRecord({
      type: PlanChangeType.DOWNGRADE,
      status: PlanChangeStatus.SCHEDULED,
      targetPlan: cheaperPlan,
      targetPlanPriceCents: cheaperPlan.monthlyCents,
      amountPayableCents: 0,
    });
    const transaction = {
      $executeRaw: jest.fn(),
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ customerId }),
      },
      planChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(request),
      },
      cancellationRequest: { count: jest.fn().mockResolvedValue(0) },
      internetPlan: { findUnique: jest.fn().mockResolvedValue(cheaperPlan) },
      invoice: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    transaction.subscription.findFirst
      .mockResolvedValueOnce({ customerId })
      .mockResolvedValueOnce(sourceSubscription);
    const { notifications, service } = makeService(transaction);

    try {
      await expect(service.request(subscriptionId, cheaperPlan.id, actor)).resolves.toEqual({
        planChange: expect.objectContaining({ status: PlanChangeStatus.SCHEDULED }),
        checkoutUrl: null,
      });
      expect(notifications.sendPlanChangeNotification).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'SCHEDULED', planChangeRequestId: request.id }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels a future scheduled downgrade but not one already effective', async () => {
    const scheduled = planChangeRecord({
      type: PlanChangeType.DOWNGRADE,
      status: PlanChangeStatus.SCHEDULED,
      effectiveAt: new Date(Date.now() + 60_000),
    });
    const cancelled = {
      ...scheduled,
      status: PlanChangeStatus.CANCELLED,
      cancelledAt: new Date(),
    };
    const transaction = {
      planChangeRequest: {
        findFirst: jest.fn().mockResolvedValue(scheduled),
        update: jest.fn().mockResolvedValue(cancelled),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = makeService(transaction);
    await expect(service.cancelScheduled(scheduled.id, actor)).resolves.toEqual(
      expect.objectContaining({ status: PlanChangeStatus.CANCELLED }),
    );

    transaction.planChangeRequest.findFirst.mockResolvedValue({
      ...scheduled,
      effectiveAt: new Date(Date.now() - 1),
    });
    await expect(service.cancelScheduled(scheduled.id, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps a pending upgrade retryable when Stripe Checkout is unavailable', async () => {
    const request = planChangeRecord({
      status: PlanChangeStatus.PENDING,
      invoiceId: 'invoice-id',
      invoice: {
        id: 'invoice-id',
        invoiceNumber: 'INV-2026-000001',
        status: 'ISSUED',
        totalCents: 1500,
      },
    });
    const create = jest.fn().mockRejectedValue(new Error('Provider unavailable'));
    const { service } = makeService(
      {},
      {
        planChangeRequest: { findUnique: jest.fn().mockResolvedValue(request) },
      },
      { client: { checkout: { sessions: { create } } } },
    );

    await expect(
      (
        service as unknown as {
          ensureUpgradeCheckout(id: string): Promise<string>;
        }
      ).ensureUpgradeCheckout(request.id),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(create).toHaveBeenCalledTimes(1);
    expect(request.status).toBe(PlanChangeStatus.PENDING);
  });

  it('reconciles a paid completed Checkout instead of returning a reuse conflict', async () => {
    const request = planChangeRecord({
      status: PlanChangeStatus.CHECKOUT_CREATED,
      stripeCheckoutSessionId: 'cs_test_paid_upgrade',
    });
    const session = {
      id: request.stripeCheckoutSessionId,
      status: 'complete',
      payment_status: 'paid',
      url: null,
    } as never;
    const { service } = makeService(
      {},
      { planChangeRequest: { findUnique: jest.fn().mockResolvedValue(request) } },
      { client: { checkout: { sessions: { retrieve: jest.fn().mockResolvedValue(session) } } } },
    );
    const internals = service as unknown as {
      ensureUpgradeCheckout(id: string): Promise<string | null>;
      reconcileStripeSession(checkout: unknown): Promise<void>;
    };
    const reconcile = jest.spyOn(internals, 'reconcileStripeSession').mockResolvedValue();

    await expect(internals.ensureUpgradeCheckout(request.id)).resolves.toBeNull();
    expect(reconcile).toHaveBeenCalledWith(session);
  });
});

function planChangeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd5a39a2c-307f-4551-b155-1d8ac76da02c',
    customerId,
    sourceSubscriptionId: subscriptionId,
    newSubscriptionId: null,
    sourcePlanId: sourcePlan.id,
    targetPlanId: targetPlan.id,
    type: PlanChangeType.UPGRADE,
    status: PlanChangeStatus.PENDING,
    currency: 'AUD',
    sourcePlanPriceCents: sourcePlan.monthlyCents,
    targetPlanPriceCents: targetPlan.monthlyCents,
    unusedCreditCents: 3450,
    proratedTargetCents: 4950,
    amountPayableCents: 1500,
    currentPeriodStartSnapshot: sourceSubscription.currentPeriodStart,
    currentPeriodEndSnapshot: sourceSubscription.currentPeriodEnd,
    requestedAt: new Date('2026-08-16T12:00:00.000Z'),
    effectiveAt: new Date('2026-08-16T12:00:00.000Z'),
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    invoiceId: null,
    paymentId: null,
    failureReason: null,
    cancellationReason: null,
    appliedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: {
      id: customerId,
      userId: actor.id,
      firstName: 'Test',
      lastName: 'Customer',
      email: actor.email,
      stripeCustomerId: null,
    },
    sourcePlan,
    targetPlan,
    sourceSubscription: { ...sourceSubscription, plan: undefined, customer: undefined },
    newSubscription: null,
    invoice: null,
    payment: null,
    ...overrides,
  };
}
