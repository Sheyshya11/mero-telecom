import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  PlanChangeStatus,
  RefundStatus,
  Role,
  StaffInvitationStatus,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { HealthService } from '../../health/health.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import type {
  AdminDashboardActivity,
  AdminDashboardSummary,
  CustomerDashboardActivity,
  CustomerDashboardSummary,
  SuperAdminDashboardSummary,
} from './dashboard.types';
import { buildInvoiceTrend, startOfTrendPeriod } from './dashboard.utils';

const ROLE_CHANGE_AUDIT_ACTIONS: string[] = [
  'USER_PROMOTED_TO_SUPER_ADMIN',
  'SUPER_ADMIN_DEMOTED',
  'ADMIN_PROMOTED',
  'ADMIN_DEMOTED',
  'SYSTEM_USER_ROLE_CHANGED',
];

const DENIED_AUDIT_ACTIONS: string[] = [
  'PRIVILEGED_ACTION_DENIED',
  'SYSTEM_ROLE_CHANGE_DENIED',
  'SYSTEM_STATUS_CHANGE_DENIED',
];

const PRIVILEGED_AUDIT_ACTIONS: string[] = [
  ...ROLE_CHANGE_AUDIT_ACTIONS,
  ...DENIED_AUDIT_ACTIONS,
  'PRIVILEGED_ACCOUNT_REACTIVATED',
  'PRIVILEGED_ACCOUNT_SUSPENDED',
  'PRIVILEGED_ACCOUNT_DEACTIVATED',
  'SYSTEM_USER_REACTIVATED',
  'SYSTEM_USER_SUSPENDED',
  'SYSTEM_USER_DEACTIVATED',
  'STAFF_INVITATION_CREATED',
  'STAFF_INVITATION_RESENT',
  'STAFF_INVITATION_REVOKED',
  'STAFF_INVITATION_ACCEPTED',
  'ADMIN_INVITATION_CREATED',
  'ADMIN_ACCESS_RECOVERED',
  'SUPER_ADMIN_INVITATION_CREATED',
  'SUPER_ADMIN_INVITATION_RESENT',
  'SUPER_ADMIN_INVITATION_ACCEPTED',
  'SUPER_ADMIN_BOOTSTRAPPED',
  'SUPER_ADMIN_BOOTSTRAP_UPDATED',
  'SUPER_ADMIN_ACCESS_RECOVERY_INITIATED',
  'SUPER_ADMIN_ACCESS_RECOVERED',
  'REFUND_OVERRIDE_USED',
];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminDashboardCache: AdminDashboardCacheService,
    private readonly health: HealthService,
  ) {}

  async getAdminSummary(): Promise<AdminDashboardSummary> {
    const cached = await this.adminDashboardCache.get<AdminDashboardSummary>();
    if (cached) return cached;

    const summary = await this.queryAdminSummary();
    await this.adminDashboardCache.set(summary);
    return summary;
  }

  private async queryAdminSummary(): Promise<AdminDashboardSummary> {
    const now = new Date();
    const pendingRefundStatuses = [
      RefundStatus.REQUESTED,
      RefundStatus.UNDER_REVIEW,
      RefundStatus.MORE_INFORMATION_REQUIRED,
      RefundStatus.APPROVED,
      RefundStatus.PROCESSING,
    ];
    const pendingPlanChangeStatuses = [
      PlanChangeStatus.PENDING,
      PlanChangeStatus.CHECKOUT_CREATED,
      PlanChangeStatus.PROCESSING,
      PlanChangeStatus.SCHEDULED,
    ];
    const [
      customerCount,
      activeSubscriptions,
      activeSubscriptionPlans,
      outstanding,
      overdueInvoiceCount,
      trendInvoices,
      subscriptionsByStatus,
      recentInvoices,
      pendingRefundSummary,
      failedPaymentCount,
      suspendedSubscriptionCount,
      pendingPlanChangeCount,
      recentCustomers,
      recentSubscriptions,
      recentPayments,
      recentRefunds,
      recentPlanChanges,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: { plan: { select: { monthlyCents: true } } },
      }),
      this.prisma.invoice.aggregate({
        where: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] } },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      this.prisma.invoice.count({ where: { status: InvoiceStatus.OVERDUE } }),
      this.prisma.invoice.findMany({
        where: {
          issueDate: { gte: startOfTrendPeriod(now) },
          status: { not: InvoiceStatus.CANCELLED },
        },
        select: { issueDate: true, totalCents: true },
      }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.invoice.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          totalCents: true,
          status: true,
          createdAt: true,
          customer: { select: { firstName: true, lastName: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.refund.aggregate({
        where: { status: { in: pendingRefundStatuses } },
        _count: { _all: true },
        _sum: { refundAmountCents: true },
      }),
      this.prisma.payment.count({
        where: {
          status: PaymentStatus.FAILED,
          invoice: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] } },
        },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.SUSPENDED } }),
      this.prisma.planChangeRequest.count({
        where: { status: { in: pendingPlanChangeStatuses } },
      }),
      this.prisma.customer.findMany({
        select: { id: true, firstName: true, lastName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.prisma.subscription.findMany({
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { firstName: true, lastName: true } },
          plan: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 4,
      }),
      this.prisma.payment.findMany({
        select: {
          id: true,
          status: true,
          amountCents: true,
          refundedCents: true,
          paidAt: true,
          createdAt: true,
          customer: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      this.prisma.refund.findMany({
        select: {
          id: true,
          status: true,
          refundAmountCents: true,
          requestedAt: true,
          processedAt: true,
          rejectedAt: true,
          updatedAt: true,
          customer: { select: { firstName: true, lastName: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 4,
      }),
      this.prisma.planChangeRequest.findMany({
        select: {
          id: true,
          type: true,
          status: true,
          requestedAt: true,
          appliedAt: true,
          cancelledAt: true,
          updatedAt: true,
          customer: { select: { firstName: true, lastName: true } },
          targetPlan: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 4,
      }),
    ]);

    const pendingRefunds = pendingRefundSummary._count._all;
    const pendingRefundAmountCents = pendingRefundSummary._sum.refundAmountCents ?? 0;
    const attention: AdminDashboardSummary['attention'] = [];
    if (failedPaymentCount > 0) {
      attention.push({
        type: 'FAILED_PAYMENTS',
        count: failedPaymentCount,
        title: `${failedPaymentCount} failed ${plural(failedPaymentCount, 'payment')}`,
        description: 'Payments linked to unpaid invoices need review.',
        actionLabel: 'Review invoices',
        actionUrl: '/admin/invoices',
        severity: 'critical',
      });
    }
    if (overdueInvoiceCount > 0) {
      attention.push({
        type: 'OVERDUE_INVOICES',
        count: overdueInvoiceCount,
        title: `${overdueInvoiceCount} overdue ${plural(overdueInvoiceCount, 'invoice')}`,
        description: 'Payment is past the invoice due date.',
        actionLabel: 'View invoices',
        actionUrl: '/admin/invoices',
        severity: 'critical',
      });
    }
    if (pendingRefunds > 0) {
      attention.push({
        type: 'PENDING_REFUNDS',
        count: pendingRefunds,
        title: `${pendingRefunds} refund ${plural(pendingRefunds, 'request')} awaiting action`,
        description: `${formatMoney(pendingRefundAmountCents)} is currently in progress.`,
        actionLabel: 'Review refunds',
        actionUrl: '/admin/refunds',
        severity: 'warning',
      });
    }
    if (suspendedSubscriptionCount > 0) {
      attention.push({
        type: 'SUSPENDED_SUBSCRIPTIONS',
        count: suspendedSubscriptionCount,
        title: `${suspendedSubscriptionCount} suspended ${plural(suspendedSubscriptionCount, 'subscription')}`,
        description: 'Review services that are not currently active.',
        actionLabel: 'View subscriptions',
        actionUrl: '/admin/subscriptions',
        severity: 'warning',
      });
    }
    if (pendingPlanChangeCount > 0) {
      attention.push({
        type: 'PENDING_PLAN_CHANGES',
        count: pendingPlanChangeCount,
        title: `${pendingPlanChangeCount} pending plan ${plural(pendingPlanChangeCount, 'change')}`,
        description: 'Requested upgrades or downgrades have not reached a final state.',
        actionLabel: 'View subscriptions',
        actionUrl: '/admin/subscriptions',
        severity: 'warning',
      });
    }

    const recentActivity: AdminDashboardActivity[] = [];
    for (const customer of recentCustomers) {
      recentActivity.push({
        id: `customer-${customer.id}`,
        kind: 'CUSTOMER',
        title: 'New customer registered',
        description: customerName(customer),
        occurredAt: customer.createdAt.toISOString(),
        amountCents: null,
        href: '/admin/customers',
        tone: 'positive',
      });
    }
    for (const subscription of recentSubscriptions) {
      recentActivity.push({
        id: `subscription-${subscription.id}`,
        kind: 'SUBSCRIPTION',
        title: adminSubscriptionActivityTitle(subscription.status),
        description: `${customerName(subscription.customer)} · ${subscription.plan.name}`,
        occurredAt: (subscription.status === SubscriptionStatus.PENDING
          ? subscription.createdAt
          : subscription.updatedAt
        ).toISOString(),
        amountCents: null,
        href: '/admin/subscriptions',
        tone:
          subscription.status === SubscriptionStatus.ACTIVE
            ? 'positive'
            : subscription.status === SubscriptionStatus.SUSPENDED
              ? 'warning'
              : 'neutral',
      });
    }
    for (const invoice of recentInvoices) {
      recentActivity.push({
        id: `invoice-${invoice.id}`,
        kind: 'INVOICE',
        title: 'Invoice generated',
        description: `${customerName(invoice.customer)} · ${invoice.invoiceNumber}`,
        occurredAt: invoice.createdAt.toISOString(),
        amountCents: invoice.totalCents,
        href: '/admin/invoices',
        tone: invoice.status === InvoiceStatus.OVERDUE ? 'warning' : 'neutral',
      });
    }
    for (const payment of recentPayments) {
      recentActivity.push({
        id: `payment-${payment.id}`,
        kind: 'PAYMENT',
        title: paymentActivityTitle(payment.status),
        description: `${customerName(payment.customer)} · ${payment.invoice.invoiceNumber}`,
        occurredAt: (payment.paidAt ?? payment.createdAt).toISOString(),
        amountCents:
          payment.status === PaymentStatus.REFUNDED ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED
            ? payment.refundedCents
            : payment.amountCents,
        href: '/admin/invoices',
        tone:
          payment.status === PaymentStatus.SUCCEEDED
            ? 'positive'
            : payment.status === PaymentStatus.FAILED
              ? 'warning'
              : 'neutral',
      });
    }
    for (const refund of recentRefunds) {
      recentActivity.push({
        id: `refund-${refund.id}`,
        kind: 'REFUND',
        title: refundActivityTitle(refund.status),
        description: `${customerName(refund.customer)} · ${refund.invoice?.invoiceNumber ?? 'Refund request'}`,
        occurredAt: (
          refund.processedAt ??
          refund.rejectedAt ??
          refund.updatedAt ??
          refund.requestedAt
        ).toISOString(),
        amountCents: refund.refundAmountCents,
        href: '/admin/refunds',
        tone:
          refund.status === RefundStatus.SUCCEEDED
            ? 'positive'
            : refund.status === RefundStatus.FAILED || refund.status === RefundStatus.REJECTED
              ? 'warning'
              : 'neutral',
      });
    }
    for (const planChange of recentPlanChanges) {
      recentActivity.push({
        id: `plan-change-${planChange.id}`,
        kind: 'PLAN_CHANGE',
        title: adminPlanChangeActivityTitle(planChange.type, planChange.status),
        description: `${customerName(planChange.customer)} · ${planChange.targetPlan.name}`,
        occurredAt: (
          planChange.appliedAt ??
          planChange.cancelledAt ??
          planChange.updatedAt ??
          planChange.requestedAt
        ).toISOString(),
        amountCents: null,
        href: '/admin/subscriptions',
        tone:
          planChange.status === PlanChangeStatus.APPLIED
            ? 'positive'
            : planChange.status === PlanChangeStatus.FAILED
              ? 'warning'
              : 'neutral',
      });
    }
    recentActivity.sort(
      (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );

    return {
      metrics: {
        customerCount,
        activeSubscriptions,
        monthlyRecurringRevenueCents: activeSubscriptionPlans.reduce(
          (total, subscription) => total + subscription.plan.monthlyCents,
          0,
        ),
        outstandingInvoiceCents: outstanding._sum.totalCents ?? 0,
        outstandingInvoiceCount: outstanding._count._all,
        overdueInvoiceCount,
        pendingRefunds,
        pendingRefundAmountCents,
        failedPaymentCount,
      },
      attention,
      invoiceTrend: buildInvoiceTrend(trendInvoices, now),
      subscriptionsByStatus: subscriptionsByStatus.map((entry) => ({
        status: entry.status,
        count: entry._count._all,
      })),
      recentInvoices: recentInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString(),
        totalCents: invoice.totalCents,
        status: invoice.status,
        paymentStatus: invoice.payments[0]?.status ?? null,
        customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
      })),
      recentActivity: recentActivity.slice(0, 8),
    };
  }

  async getSuperAdminSummary(): Promise<SuperAdminDashboardSummary> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    const [
      business,
      activeSuperAdmins,
      activeAdmins,
      activeStaff,
      restrictedPrivilegedAccounts,
      restrictedStaffAccounts,
      pendingInvitations,
      recentRoleChanges,
      privilegedActionsToday,
      deniedPrivilegedActionsLast24Hours,
      recentAuditLogs,
      dependencyChecks,
    ] = await Promise.all([
      this.getAdminSummary(),
      this.prisma.user.count({
        where: { role: Role.SUPER_ADMIN, status: UserStatus.ACTIVE, isActive: true },
      }),
      this.prisma.user.count({
        where: { role: Role.ADMIN, status: UserStatus.ACTIVE, isActive: true },
      }),
      this.prisma.user.count({
        where: { role: Role.STAFF, status: UserStatus.ACTIVE, isActive: true },
      }),
      this.prisma.user.count({
        where: {
          role: { in: [Role.SUPER_ADMIN, Role.ADMIN] },
          OR: [
            { isActive: false },
            { status: { in: [UserStatus.SUSPENDED, UserStatus.DEACTIVATED] } },
          ],
        },
      }),
      this.prisma.user.count({
        where: {
          role: Role.STAFF,
          OR: [
            { isActive: false },
            { status: { in: [UserStatus.SUSPENDED, UserStatus.DEACTIVATED] } },
          ],
        },
      }),
      this.prisma.staffInvitation.count({
        where: { status: StaffInvitationStatus.PENDING, expiresAt: { gt: now } },
      }),
      this.prisma.auditLog.count({
        where: { action: { in: ROLE_CHANGE_AUDIT_ACTIONS }, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.auditLog.count({
        where: { action: { in: PRIVILEGED_AUDIT_ACTIONS }, createdAt: { gte: startOfToday } },
      }),
      this.prisma.auditLog.count({
        where: { action: { in: DENIED_AUDIT_ACTIONS }, createdAt: { gte: twentyFourHoursAgo } },
      }),
      this.prisma.auditLog.findMany({
        where: { action: { in: PRIVILEGED_AUDIT_ACTIONS } },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { displayName: true, email: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.health.getDependencyChecks(),
    ]);

    const userIds = recentAuditLogs
      .filter((log) => log.entityType === 'User')
      .map((log) => log.entityId);
    const invitationIds = recentAuditLogs
      .filter((log) => log.entityType === 'StaffInvitation')
      .map((log) => log.entityId);
    const [affectedUsers, affectedInvitations] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: [...new Set(userIds)] } },
            select: { id: true, displayName: true, email: true },
          })
        : Promise.resolve([]),
      invitationIds.length
        ? this.prisma.staffInvitation.findMany({
            where: { id: { in: [...new Set(invitationIds)] } },
            select: { id: true, email: true, role: true },
          })
        : Promise.resolve([]),
    ]);
    const userLabels = new Map(
      affectedUsers.map((user) => [user.id, user.displayName ?? user.email] as const),
    );
    const invitationLabels = new Map(
      affectedInvitations.map(
        (invitation) =>
          [
            invitation.id,
            `${friendlyRole(invitation.role)} invitation for ${invitation.email}`,
          ] as const,
      ),
    );

    const attention: SuperAdminDashboardSummary['attention'] = [...business.attention];
    if (restrictedPrivilegedAccounts > 0) {
      attention.push({
        type: 'RESTRICTED_ADMINS',
        count: restrictedPrivilegedAccounts,
        title: `${restrictedPrivilegedAccounts} restricted privileged ${plural(restrictedPrivilegedAccounts, 'account')}`,
        description: 'Suspended or deactivated administrator access requires review.',
        actionLabel: 'Manage admins',
        actionUrl: '/admin/users',
        severity: 'critical',
      });
    }
    if (restrictedStaffAccounts > 0) {
      attention.push({
        type: 'RESTRICTED_STAFF',
        count: restrictedStaffAccounts,
        title: `${restrictedStaffAccounts} restricted staff ${plural(restrictedStaffAccounts, 'account')}`,
        description: 'Suspended or deactivated staff access may require follow-up.',
        actionLabel: 'Manage staff',
        actionUrl: '/admin/users',
        severity: 'warning',
      });
    }
    if (deniedPrivilegedActionsLast24Hours > 0) {
      attention.push({
        type: 'PRIVILEGED_ACTIONS_DENIED',
        count: deniedPrivilegedActionsLast24Hours,
        title: `${deniedPrivilegedActionsLast24Hours} denied privileged ${plural(deniedPrivilegedActionsLast24Hours, 'action')}`,
        description: 'Review recent denied administrative actions in the security audit.',
        actionLabel: 'View audit logs',
        actionUrl: '/admin/users',
        severity: 'critical',
      });
    }

    return {
      business: business.metrics,
      organisation: {
        activeSuperAdmins,
        activeAdmins,
        activeStaff,
        restrictedInternalAccounts: restrictedPrivilegedAccounts + restrictedStaffAccounts,
        pendingInvitations,
      },
      governance: {
        recentRoleChanges,
        privilegedActionsToday,
        deniedPrivilegedActionsLast24Hours,
      },
      attention,
      invoiceTrend: business.invoiceTrend,
      subscriptionsByStatus: business.subscriptionsByStatus,
      recentPrivilegedActivity: recentAuditLogs.map((log) => {
        const actor = log.actor?.displayName ?? log.actor?.email ?? 'System process';
        const target =
          (log.entityType === 'User' ? userLabels.get(log.entityId) : undefined) ??
          (log.entityType === 'StaffInvitation' ? invitationLabels.get(log.entityId) : undefined) ??
          friendlyAuditEntity(log.entityType);
        return {
          id: log.id,
          title: friendlyAuditAction(log.action),
          description: `${actor} · ${target}`,
          occurredAt: log.createdAt.toISOString(),
          href: '/admin/users',
          tone: auditTone(log.action),
        };
      }),
      recentBusinessActivity: business.recentActivity,
      systemHealth: [
        {
          name: 'Database',
          status: dependencyChecks.database === 'ok' ? 'HEALTHY' : 'DEGRADED',
          description:
            dependencyChecks.database === 'ok'
              ? 'PostgreSQL is responding normally.'
              : 'PostgreSQL did not pass the latest readiness check.',
        },
        {
          name: 'Redis',
          status: dependencyChecks.redis === 'ok' ? 'HEALTHY' : 'DEGRADED',
          description:
            dependencyChecks.redis === 'ok'
              ? 'Redis is responding normally.'
              : 'Redis did not pass the latest readiness check.',
        },
      ],
      observedAt: now.toISOString(),
    };
  }

  async getCustomerSummary(user: AuthenticatedUser): Promise<CustomerDashboardSummary> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');

    const [
      currentSubscription,
      outstanding,
      invoices,
      payments,
      refunds,
      planChanges,
      pendingRefund,
      pendingPlanChange,
    ] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: {
          customerId: customer.id,
          status: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED],
          },
        },
        select: {
          id: true,
          status: true,
          startDate: true,
          currentPeriodEnd: true,
          createdAt: true,
          plan: {
            select: {
              name: true,
              downloadMbps: true,
              uploadMbps: true,
              monthlyCents: true,
            },
          },
        },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.invoice.aggregate({
        where: {
          customerId: customer.id,
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        },
        _sum: { totalCents: true },
      }),
      this.prisma.invoice.findMany({
        where: { customerId: customer.id },
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          totalCents: true,
          status: true,
          createdAt: true,
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              amountCents: true,
              refundedCents: true,
              currency: true,
              status: true,
              paidAt: true,
            },
          },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 3,
      }),
      this.prisma.payment.findMany({
        where: { customerId: customer.id },
        select: {
          id: true,
          status: true,
          amountCents: true,
          refundedCents: true,
          paidAt: true,
          createdAt: true,
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      this.prisma.refund.findMany({
        where: { customerId: customer.id },
        select: {
          id: true,
          status: true,
          refundAmountCents: true,
          requestedAt: true,
          processedAt: true,
          rejectedAt: true,
          updatedAt: true,
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      }),
      this.prisma.planChangeRequest.findMany({
        where: { customerId: customer.id },
        select: {
          id: true,
          type: true,
          status: true,
          requestedAt: true,
          effectiveAt: true,
          appliedAt: true,
          cancelledAt: true,
          updatedAt: true,
          targetPlan: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      }),
      this.prisma.refund.findFirst({
        where: {
          customerId: customer.id,
          status: {
            in: [
              RefundStatus.REQUESTED,
              RefundStatus.UNDER_REVIEW,
              RefundStatus.MORE_INFORMATION_REQUIRED,
              RefundStatus.APPROVED,
              RefundStatus.PROCESSING,
            ],
          },
        },
        select: { status: true, refundAmountCents: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.planChangeRequest.findFirst({
        where: {
          customerId: customer.id,
          status: {
            in: [
              PlanChangeStatus.PENDING,
              PlanChangeStatus.CHECKOUT_CREATED,
              PlanChangeStatus.PROCESSING,
              PlanChangeStatus.SCHEDULED,
            ],
          },
        },
        select: {
          status: true,
          effectiveAt: true,
          targetPlan: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const serializedInvoices: CustomerDashboardSummary['invoices'] = invoices.map((invoice) => {
      const payment = invoice.payments[0] ?? null;
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        totalCents: invoice.totalCents,
        status: invoice.status,
        paymentStatus: payment?.status ?? null,
        payment: payment
          ? {
              ...payment,
              paidAt: payment.paidAt?.toISOString() ?? null,
            }
          : null,
      };
    });
    const latestInvoice = serializedInvoices[0] ?? null;
    const latestPayment = payments[0] ?? null;
    const outstandingInvoiceCents = outstanding._sum.totalCents ?? 0;
    const openInvoice = serializedInvoices.find(
      (invoice) =>
        invoice.status === InvoiceStatus.ISSUED || invoice.status === InvoiceStatus.OVERDUE,
    );
    let pendingAction: CustomerDashboardSummary['pendingAction'] = null;

    if (currentSubscription?.status === SubscriptionStatus.SUSPENDED) {
      pendingAction = {
        type: 'SERVICE',
        title: 'Internet service suspended',
        description: 'Your internet service is currently suspended. Review your service details.',
        actionLabel: 'View service',
        actionUrl: '/customer/subscription',
        severity: 'critical',
      };
    } else if (latestPayment?.status === PaymentStatus.FAILED) {
      pendingAction = {
        type: 'PAYMENT',
        title: 'Payment action required',
        description: `${latestPayment.invoice.invoiceNumber} has an unsuccessful payment. Review your billing before trying again.`,
        actionLabel: 'View billing',
        actionUrl: '/customer/invoices',
        severity: 'critical',
      };
    } else if (outstandingInvoiceCents > 0) {
      pendingAction = {
        type: 'PAYMENT',
        title: openInvoice?.status === InvoiceStatus.OVERDUE ? 'Invoice overdue' : 'Payment due',
        description: openInvoice
          ? `${openInvoice.invoiceNumber} has ${formatMoney(outstandingInvoiceCents)} outstanding.`
          : `Your account has ${formatMoney(outstandingInvoiceCents)} outstanding.`,
        actionLabel: 'View billing',
        actionUrl: '/customer/invoices',
        severity: openInvoice?.status === InvoiceStatus.OVERDUE ? 'critical' : 'warning',
      };
    } else if (pendingPlanChange) {
      pendingAction = {
        type: 'PLAN_CHANGE',
        title:
          pendingPlanChange.status === PlanChangeStatus.SCHEDULED
            ? 'Plan change scheduled'
            : 'Plan change in progress',
        description:
          pendingPlanChange.status === PlanChangeStatus.SCHEDULED
            ? `Your plan will change to ${pendingPlanChange.targetPlan.name} on ${formatDate(pendingPlanChange.effectiveAt)}.`
            : `Your change to ${pendingPlanChange.targetPlan.name} is being processed.`,
        actionLabel: 'View plan',
        actionUrl: '/customer/subscription',
        severity: 'warning',
      };
    } else if (pendingRefund) {
      pendingAction = {
        type: 'REFUND',
        title:
          pendingRefund.status === RefundStatus.MORE_INFORMATION_REQUIRED
            ? 'Refund needs information'
            : 'Refund under review',
        description:
          pendingRefund.status === RefundStatus.MORE_INFORMATION_REQUIRED
            ? 'More information is required before your refund request can continue.'
            : `Your ${formatMoney(pendingRefund.refundAmountCents)} refund request is being reviewed.`,
        actionLabel: 'View refund',
        actionUrl: '/customer/refunds',
        severity: 'warning',
      };
    }

    const recentActivity: CustomerDashboardActivity[] = [];
    for (const invoice of invoices) {
      recentActivity.push({
        id: `invoice-${invoice.id}`,
        kind: 'INVOICE',
        title: 'Invoice generated',
        description: invoice.invoiceNumber,
        occurredAt: invoice.createdAt.toISOString(),
        amountCents: invoice.totalCents,
        href: '/customer/invoices',
        tone: invoice.status === InvoiceStatus.OVERDUE ? 'warning' : 'neutral',
      });
    }
    for (const payment of payments) {
      recentActivity.push({
        id: `payment-${payment.id}`,
        kind: 'PAYMENT',
        title: paymentActivityTitle(payment.status),
        description: payment.invoice.invoiceNumber,
        occurredAt: (payment.paidAt ?? payment.createdAt).toISOString(),
        amountCents:
          payment.status === PaymentStatus.REFUNDED ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED
            ? payment.refundedCents
            : payment.amountCents,
        href: '/customer/invoices',
        tone:
          payment.status === PaymentStatus.SUCCEEDED
            ? 'positive'
            : payment.status === PaymentStatus.FAILED
              ? 'warning'
              : 'neutral',
      });
    }
    for (const refund of refunds) {
      recentActivity.push({
        id: `refund-${refund.id}`,
        kind: 'REFUND',
        title: refundActivityTitle(refund.status),
        description: refund.invoice?.invoiceNumber ?? 'Refund request',
        occurredAt: (
          refund.processedAt ??
          refund.rejectedAt ??
          refund.updatedAt ??
          refund.requestedAt
        ).toISOString(),
        amountCents: refund.refundAmountCents,
        href: '/customer/refunds',
        tone:
          refund.status === RefundStatus.SUCCEEDED
            ? 'positive'
            : refund.status === RefundStatus.FAILED || refund.status === RefundStatus.REJECTED
              ? 'warning'
              : 'neutral',
      });
    }
    for (const planChange of planChanges) {
      recentActivity.push({
        id: `plan-change-${planChange.id}`,
        kind: 'PLAN_CHANGE',
        title: planChangeActivityTitle(planChange.status),
        description: `${planChange.type === 'UPGRADE' ? 'Upgrade' : 'Downgrade'} to ${planChange.targetPlan.name}`,
        occurredAt: (
          planChange.appliedAt ??
          planChange.cancelledAt ??
          planChange.updatedAt ??
          planChange.requestedAt
        ).toISOString(),
        amountCents: null,
        href: '/customer/subscription',
        tone:
          planChange.status === PlanChangeStatus.APPLIED
            ? 'positive'
            : planChange.status === PlanChangeStatus.FAILED
              ? 'warning'
              : 'neutral',
      });
    }
    if (currentSubscription) {
      recentActivity.push({
        id: `subscription-${currentSubscription.id}`,
        kind: 'SUBSCRIPTION',
        title:
          currentSubscription.status === SubscriptionStatus.ACTIVE
            ? 'Internet service activated'
            : 'Internet service suspended',
        description: currentSubscription.plan.name,
        occurredAt: currentSubscription.createdAt.toISOString(),
        amountCents: null,
        href: '/customer/subscription',
        tone: currentSubscription.status === SubscriptionStatus.ACTIVE ? 'positive' : 'warning',
      });
    }
    recentActivity.sort(
      (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );

    return {
      profile: {
        customerNumber: customer.customerNumber,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.phone,
      },
      subscription: currentSubscription
        ? {
            id: currentSubscription.id,
            status: currentSubscription.status,
            startDate: currentSubscription.startDate.toISOString(),
            plan: {
              name: currentSubscription.plan.name,
              downloadMbps: currentSubscription.plan.downloadMbps,
              uploadMbps: currentSubscription.plan.uploadMbps,
              monthlyCents: currentSubscription.plan.monthlyCents,
            },
          }
        : null,
      billing: {
        nextPaymentAmountCents:
          currentSubscription?.status === SubscriptionStatus.ACTIVE
            ? currentSubscription.plan.monthlyCents
            : null,
        nextBillingDate:
          currentSubscription?.status === SubscriptionStatus.ACTIVE
            ? currentSubscription.currentPeriodEnd.toISOString()
            : null,
        outstandingInvoiceCents,
        latestPaymentStatus: latestPayment?.status ?? null,
      },
      pendingAction,
      recentActivity: recentActivity.slice(0, 5),
      latestInvoice,
      invoices: serializedInvoices,
    };
  }
}

function customerName(customer: { firstName: string; lastName: string }) {
  return `${customer.firstName} ${customer.lastName}`;
}

function plural(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}

function adminSubscriptionActivityTitle(status: SubscriptionStatus) {
  switch (status) {
    case SubscriptionStatus.ACTIVE:
      return 'Subscription activated';
    case SubscriptionStatus.SUSPENDED:
      return 'Subscription suspended';
    case SubscriptionStatus.CANCELLED:
      return 'Subscription cancelled';
    default:
      return 'Subscription created';
  }
}

function adminPlanChangeActivityTitle(type: 'UPGRADE' | 'DOWNGRADE', status: PlanChangeStatus) {
  if (status === PlanChangeStatus.APPLIED) {
    return type === 'UPGRADE' ? 'Plan upgraded' : 'Plan downgraded';
  }
  if (status === PlanChangeStatus.SCHEDULED) {
    return type === 'UPGRADE' ? 'Plan upgrade scheduled' : 'Plan downgrade scheduled';
  }
  if (status === PlanChangeStatus.FAILED) return 'Plan change unsuccessful';
  if (status === PlanChangeStatus.CANCELLED || status === PlanChangeStatus.EXPIRED) {
    return 'Plan change cancelled';
  }
  return type === 'UPGRADE' ? 'Plan upgrade requested' : 'Plan downgrade requested';
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Adelaide',
  }).format(date);
}

function paymentActivityTitle(status: PaymentStatus) {
  switch (status) {
    case PaymentStatus.SUCCEEDED:
      return 'Payment received';
    case PaymentStatus.FAILED:
      return 'Payment unsuccessful';
    case PaymentStatus.PARTIALLY_REFUNDED:
      return 'Payment partially refunded';
    case PaymentStatus.REFUNDED:
      return 'Payment refunded';
    default:
      return 'Payment processing';
  }
}

function refundActivityTitle(status: RefundStatus) {
  switch (status) {
    case RefundStatus.SUCCEEDED:
      return 'Refund completed';
    case RefundStatus.REJECTED:
      return 'Refund request declined';
    case RefundStatus.FAILED:
      return 'Refund unsuccessful';
    case RefundStatus.CANCELLED:
      return 'Refund request cancelled';
    case RefundStatus.MORE_INFORMATION_REQUIRED:
      return 'Refund needs information';
    case RefundStatus.UNDER_REVIEW:
    case RefundStatus.APPROVED:
    case RefundStatus.PROCESSING:
      return 'Refund under review';
    default:
      return 'Refund requested';
  }
}

function planChangeActivityTitle(status: PlanChangeStatus) {
  switch (status) {
    case PlanChangeStatus.APPLIED:
      return 'Plan change completed';
    case PlanChangeStatus.SCHEDULED:
      return 'Plan change scheduled';
    case PlanChangeStatus.CANCELLED:
    case PlanChangeStatus.EXPIRED:
      return 'Plan change cancelled';
    case PlanChangeStatus.FAILED:
      return 'Plan change unsuccessful';
    default:
      return 'Plan change requested';
  }
}

function friendlyRole(role: Role): string {
  if (role === Role.SUPER_ADMIN) return 'Super Admin';
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function friendlyAuditEntity(entityType: string): string {
  const labels: Record<string, string> = {
    User: 'Internal account',
    StaffInvitation: 'Internal invitation',
    Refund: 'Refund request',
    HttpRoute: 'Protected administrative route',
  };
  return labels[entityType] ?? 'Administrative record';
}

function friendlyAuditAction(action: string): string {
  const labels: Record<string, string> = {
    USER_PROMOTED_TO_SUPER_ADMIN: 'Super Admin role granted',
    SUPER_ADMIN_DEMOTED: 'Super Admin role removed',
    ADMIN_PROMOTED: 'Administrator role granted',
    ADMIN_DEMOTED: 'Administrator role removed',
    SYSTEM_USER_ROLE_CHANGED: 'Internal user role changed',
    PRIVILEGED_ACCOUNT_REACTIVATED: 'Privileged account reactivated',
    PRIVILEGED_ACCOUNT_SUSPENDED: 'Privileged account suspended',
    PRIVILEGED_ACCOUNT_DEACTIVATED: 'Privileged account deactivated',
    SYSTEM_USER_REACTIVATED: 'Staff account reactivated',
    SYSTEM_USER_SUSPENDED: 'Staff account suspended',
    SYSTEM_USER_DEACTIVATED: 'Staff account deactivated',
    STAFF_INVITATION_CREATED: 'Staff invitation created',
    STAFF_INVITATION_RESENT: 'Staff invitation resent',
    STAFF_INVITATION_REVOKED: 'Staff invitation revoked',
    STAFF_INVITATION_ACCEPTED: 'Staff invitation accepted',
    ADMIN_INVITATION_CREATED: 'Administrator invitation created',
    ADMIN_ACCESS_RECOVERED: 'Administrator access recovered',
    SUPER_ADMIN_INVITATION_CREATED: 'Super Admin invitation created',
    SUPER_ADMIN_INVITATION_RESENT: 'Super Admin invitation resent',
    SUPER_ADMIN_INVITATION_ACCEPTED: 'Super Admin invitation accepted',
    SUPER_ADMIN_BOOTSTRAPPED: 'Super Admin provisioned',
    SUPER_ADMIN_BOOTSTRAP_UPDATED: 'Super Admin bootstrap updated',
    SUPER_ADMIN_ACCESS_RECOVERY_INITIATED: 'Super Admin recovery started',
    SUPER_ADMIN_ACCESS_RECOVERED: 'Super Admin access recovered',
    PRIVILEGED_ACTION_DENIED: 'Privileged route access denied',
    SYSTEM_ROLE_CHANGE_DENIED: 'Internal role change denied',
    SYSTEM_STATUS_CHANGE_DENIED: 'Internal account change denied',
    REFUND_OVERRIDE_USED: 'Refund override approved',
  };
  return labels[action] ?? 'Privileged administrative action';
}

function auditTone(action: string): 'positive' | 'warning' | 'neutral' {
  if (DENIED_AUDIT_ACTIONS.includes(action) || action.includes('SUSPENDED')) return 'warning';
  if (
    action.includes('ACCEPTED') ||
    action.includes('REACTIVATED') ||
    action.includes('RECOVERED') ||
    action.includes('BOOTSTRAPPED')
  ) {
    return 'positive';
  }
  return 'neutral';
}
