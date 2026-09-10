import {
  InvoiceStatus,
  PaymentStatus,
  PlanChangeStatus,
  RefundStatus,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { HealthService } from '../../health/health.service';
import type { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import { DashboardService } from './dashboard.service';
import type { AdminDashboardSummary } from './dashboard.types';

const cachedSummary: AdminDashboardSummary = {
  metrics: {
    customerCount: 2,
    activeSubscriptions: 1,
    monthlyRecurringRevenueCents: 6900,
    outstandingInvoiceCents: 6900,
    outstandingInvoiceCount: 1,
    overdueInvoiceCount: 0,
    pendingRefunds: 0,
    pendingRefundAmountCents: 0,
    failedPaymentCount: 0,
  },
  attention: [],
  invoiceTrend: [],
  subscriptionsByStatus: [{ status: SubscriptionStatus.ACTIVE, count: 1 }],
  recentInvoices: [],
  recentActivity: [],
};

function createPrisma() {
  return {
    customer: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ plan: { monthlyCents: 6900 } }])
        .mockResolvedValueOnce([]),
      groupBy: jest
        .fn()
        .mockResolvedValue([{ status: SubscriptionStatus.ACTIVE, _count: { _all: 1 } }]),
    },
    invoice: {
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 1 }, _sum: { totalCents: 6900 } }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { issueDate: new Date('2026-08-01T00:00:00.000Z'), totalCents: 6900 },
        ])
        .mockResolvedValueOnce([
          {
            id: 'invoice-id',
            invoiceNumber: 'INV-2026-000002',
            issueDate: new Date('2026-08-01T00:00:00.000Z'),
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            totalCents: 6900,
            status: InvoiceStatus.ISSUED,
            payments: [],
            customer: { firstName: 'Anika', lastName: 'Singh' },
          },
        ]),
    },
    refund: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _count: { _all: 0 }, _sum: { refundAmountCents: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    planChangeRequest: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function createHealth() {
  return {
    getDependencyChecks: jest.fn().mockResolvedValue({ database: 'ok', redis: 'ok' }),
  } as unknown as HealthService;
}

describe('DashboardService admin cache', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('queries PostgreSQL on a miss and caches the completed summary', async () => {
    const prisma = createPrisma();
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      cache as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getAdminSummary();

    expect(summary.metrics.customerCount).toBe(2);
    expect(summary.metrics.activeSubscriptions).toBe(1);
    expect(summary.metrics.monthlyRecurringRevenueCents).toBe(6900);
    expect(summary.metrics.outstandingInvoiceCents).toBe(6900);
    expect(summary.metrics.outstandingInvoiceCount).toBe(1);
    expect(summary.metrics.pendingRefunds).toBe(0);
    expect(summary.attention).toEqual([]);
    expect(summary.recentInvoices[0]?.issueDate).toBe('2026-08-01T00:00:00.000Z');
    expect(summary.recentInvoices).toHaveLength(1);
    expect(summary.recentActivity).toHaveLength(1);
    expect(prisma.customer.count).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(summary);
  });

  it('returns a cache hit without issuing dashboard database queries', async () => {
    const prisma = createPrisma();
    const cache = {
      get: jest.fn().mockResolvedValue(cachedSummary),
      set: jest.fn().mockResolvedValue(true),
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      cache as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    await expect(service.getAdminSummary()).resolves.toBe(cachedSummary);
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(prisma.subscription.count).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('returns only real actionable issues and limits the combined activity feed', async () => {
    const prisma = createPrisma();
    prisma.invoice.count.mockResolvedValue(2);
    prisma.refund.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { refundAmountCents: 22400 },
    });
    prisma.payment.count.mockResolvedValue(1);
    prisma.subscription.count.mockReset().mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.planChangeRequest.count.mockResolvedValue(1);
    prisma.customer.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `customer-${index}`,
        firstName: 'Customer',
        lastName: String(index),
        createdAt: new Date(`2026-08-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`),
      })),
    );
    prisma.payment.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({
        id: `payment-${index}`,
        status: index === 0 ? PaymentStatus.FAILED : PaymentStatus.SUCCEEDED,
        amountCents: 2530,
        refundedCents: 0,
        paidAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
        createdAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
        customer: { firstName: 'Anika', lastName: 'Singh' },
        invoice: { invoiceNumber: `INV-${index}` },
      })),
    );
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
      } as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getAdminSummary();

    expect(summary.metrics.pendingRefunds).toBe(3);
    expect(summary.metrics.pendingRefundAmountCents).toBe(22400);
    expect(summary.attention.map((item) => item.type)).toEqual([
      'FAILED_PAYMENTS',
      'OVERDUE_INVOICES',
      'PENDING_REFUNDS',
      'SUSPENDED_SUBSCRIPTIONS',
      'PENDING_PLAN_CHANGES',
    ]);
    expect(summary.recentActivity).toHaveLength(8);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(prisma.invoice.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 5 }));
  });
});

describe('DashboardService Super Admin summary', () => {
  it('combines business, organisation, governance and real dependency health data', async () => {
    const auditLogs = Array.from({ length: 10 }, (_, index) => ({
      id: `audit-${index}`,
      action: index === 0 ? 'SYSTEM_ROLE_CHANGE_DENIED' : 'ADMIN_PROMOTED',
      entityType: 'User',
      entityId: `user-${index}`,
      createdAt: new Date(`2026-09-0${Math.min(index + 1, 7)}T00:00:00.000Z`),
      actor: { displayName: 'Morgan Lee', email: 'morgan@example.test' },
    }));
    const prisma = {
      user: {
        count: jest
          .fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(2),
        findMany: jest.fn().mockResolvedValue(
          auditLogs.map((log, index) => ({
            id: log.entityId,
            displayName: `Internal user ${index}`,
            email: `user-${index}@example.test`,
          })),
        ),
      },
      staffInvitation: {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(7).mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValue(auditLogs),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(cachedSummary),
      set: jest.fn(),
    };
    const health = createHealth();
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      cache as unknown as AdminDashboardCacheService,
      health,
    );

    const summary = await service.getSuperAdminSummary();

    expect(summary.business).toBe(cachedSummary.metrics);
    expect(summary.organisation).toEqual({
      activeSuperAdmins: 2,
      activeAdmins: 3,
      activeStaff: 12,
      restrictedInternalAccounts: 3,
      pendingInvitations: 4,
    });
    expect(summary.governance).toEqual({
      recentRoleChanges: 5,
      privilegedActionsToday: 7,
      deniedPrivilegedActionsLast24Hours: 1,
    });
    expect(summary.attention.map((item) => item.type)).toEqual([
      'RESTRICTED_ADMINS',
      'RESTRICTED_STAFF',
      'PRIVILEGED_ACTIONS_DENIED',
    ]);
    expect(summary.systemHealth).toEqual([
      expect.objectContaining({ name: 'Database', status: 'HEALTHY' }),
      expect.objectContaining({ name: 'Redis', status: 'HEALTHY' }),
    ]);
    expect(summary.recentPrivilegedActivity).toHaveLength(10);
    expect(summary.recentPrivilegedActivity[0]).toEqual(
      expect.objectContaining({
        title: 'Internal role change denied',
        description: 'Morgan Lee · Internal user 0',
      }),
    );
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        select: expect.not.objectContaining({ metadata: expect.anything() }),
      }),
    );
    expect(JSON.stringify(summary)).not.toContain('passwordHash');
    expect(JSON.stringify(summary)).not.toContain('token');
  });

  it('does not create attention items when no real issue exists', async () => {
    const prisma = {
      user: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      staffInvitation: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(cachedSummary),
        set: jest.fn(),
      } as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getSuperAdminSummary();

    expect(summary.attention).toEqual([]);
    expect(summary.recentPrivilegedActivity).toEqual([]);
  });
});

describe('DashboardService customer summary', () => {
  const actor = { id: 'user-1', email: 'customer@example.test', role: Role.CUSTOMER };
  const customer = {
    id: 'customer-1',
    customerNumber: 'CUST-000001',
    firstName: 'Anika',
    lastName: 'Singh',
    email: 'customer@example.test',
    phone: '0400000000',
  };

  function createCustomerPrisma() {
    return {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'subscription-1',
          status: SubscriptionStatus.ACTIVE,
          startDate: new Date('2026-08-24T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-09-24T00:00:00.000Z'),
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
          plan: {
            name: 'NBN 100',
            downloadMbps: 100,
            uploadMbps: 40,
            monthlyCents: 9900,
          },
        }),
      },
      invoice: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            invoiceNumber: 'INV-2026-000001',
            issueDate: new Date('2026-09-01T00:00:00.000Z'),
            dueDate: new Date('2026-09-15T00:00:00.000Z'),
            totalCents: 9900,
            status: InvoiceStatus.PAID,
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
            payments: [
              {
                id: 'payment-1',
                amountCents: 9900,
                refundedCents: 0,
                currency: 'AUD',
                status: PaymentStatus.SUCCEEDED,
                paidAt: new Date('2026-09-02T00:00:00.000Z'),
              },
            ],
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payment-1',
            status: PaymentStatus.SUCCEEDED,
            amountCents: 9900,
            refundedCents: 0,
            paidAt: new Date('2026-09-02T00:00:00.000Z'),
            createdAt: new Date('2026-09-02T00:00:00.000Z'),
            invoice: { invoiceNumber: 'INV-2026-000001' },
          },
        ]),
      },
      refund: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      planChangeRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      cancellationRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
  }

  it('returns current-customer billing and recent activity without exposing another customer', async () => {
    const prisma = createCustomerPrisma();
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      { get: jest.fn(), set: jest.fn() } as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getCustomerSummary(actor);

    expect(prisma.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: actor.id } }),
    );
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: customer.id }) }),
    );
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: customer.id }, take: 3 }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: customer.id }, take: 3 }),
    );
    expect(summary.billing).toEqual({
      nextPaymentAmountCents: 9900,
      nextBillingDate: '2026-09-24T00:00:00.000Z',
      outstandingInvoiceCents: 0,
      latestPaymentStatus: PaymentStatus.SUCCEEDED,
    });
    expect(summary.pendingAction).toBeNull();
    expect(summary.invoices).toHaveLength(1);
    expect(summary.invoices[0]?.payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(summary.recentActivity.map((activity) => activity.title)).toEqual(
      expect.arrayContaining(['Payment received', 'Invoice generated']),
    );
  });

  it('handles a customer without a current service or activity', async () => {
    const prisma = createCustomerPrisma();
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      { get: jest.fn(), set: jest.fn() } as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getCustomerSummary(actor);

    expect(summary.subscription).toBeNull();
    expect(summary.billing.nextPaymentAmountCents).toBeNull();
    expect(summary.billing.nextBillingDate).toBeNull();
    expect(summary.latestInvoice).toBeNull();
    expect(summary.recentActivity).toEqual([]);
    expect(summary.pendingAction).toBeNull();
  });

  it('prioritises failed-payment alerts and translates refund and plan-change activity', async () => {
    const prisma = createCustomerPrisma();
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-failed',
        status: PaymentStatus.FAILED,
        amountCents: 9900,
        refundedCents: 0,
        paidAt: null,
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
        invoice: { invoiceNumber: 'INV-2026-000002' },
      },
    ]);
    prisma.refund.findMany.mockResolvedValue([
      {
        id: 'refund-1',
        status: RefundStatus.UNDER_REVIEW,
        refundAmountCents: 2500,
        requestedAt: new Date('2026-09-03T00:00:00.000Z'),
        processedAt: null,
        rejectedAt: null,
        updatedAt: new Date('2026-09-04T00:00:00.000Z'),
        invoice: { invoiceNumber: 'INV-2026-000001' },
      },
    ]);
    prisma.planChangeRequest.findMany.mockResolvedValue([
      {
        id: 'change-1',
        type: 'DOWNGRADE',
        status: PlanChangeStatus.SCHEDULED,
        requestedAt: new Date('2026-09-01T00:00:00.000Z'),
        effectiveAt: new Date('2026-09-24T00:00:00.000Z'),
        appliedAt: null,
        cancelledAt: null,
        updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        targetPlan: { name: 'NBN 50' },
      },
    ]);
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      { get: jest.fn(), set: jest.fn() } as unknown as AdminDashboardCacheService,
      createHealth(),
    );

    const summary = await service.getCustomerSummary(actor);

    expect(summary.pendingAction).toEqual(
      expect.objectContaining({ type: 'PAYMENT', title: 'Payment action required' }),
    );
    expect(summary.recentActivity.map((activity) => activity.title)).toEqual(
      expect.arrayContaining([
        'Payment unsuccessful',
        'Refund under review',
        'Plan change scheduled',
      ]),
    );
  });
});
