import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminDashboardCacheService } from '../cache/admin-dashboard-cache.service';
import type { AdminDashboardSummary } from './dashboard.types';
import { buildInvoiceTrend, startOfTrendPeriod } from './dashboard.utils';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminDashboardCache: AdminDashboardCacheService,
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
    const [
      customerCount,
      activeSubscriptions,
      activeSubscriptionPlans,
      outstanding,
      overdueInvoiceCount,
      trendInvoices,
      subscriptionsByStatus,
      recentInvoices,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: { plan: { select: { monthlyCents: true } } },
      }),
      this.prisma.invoice.aggregate({
        where: { status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] } },
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
        include: { customer: { select: { firstName: true, lastName: true } } },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

    return {
      metrics: {
        customerCount,
        activeSubscriptions,
        monthlyRecurringRevenueCents: activeSubscriptionPlans.reduce(
          (total, subscription) => total + subscription.plan.monthlyCents,
          0,
        ),
        outstandingInvoiceCents: outstanding._sum.totalCents ?? 0,
        overdueInvoiceCount,
      },
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
        customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
      })),
    };
  }

  async getCustomerSummary(user: AuthenticatedUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
      select: {
        customerNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer account not found.');

    const [currentSubscription, latestInvoice, outstanding, invoices] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: {
          customer: { userId: user.id },
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.PENDING,
              SubscriptionStatus.SUSPENDED,
            ],
          },
        },
        include: { plan: true },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.invoice.findFirst({
        where: { customer: { userId: user.id } },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.invoice.aggregate({
        where: {
          customer: { userId: user.id },
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        },
        _sum: { totalCents: true },
      }),
      this.prisma.invoice.findMany({
        where: { customer: { userId: user.id } },
        include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);

    return {
      profile: customer,
      subscription: currentSubscription
        ? {
            id: currentSubscription.id,
            status: currentSubscription.status,
            startDate: currentSubscription.startDate,
            plan: {
              name: currentSubscription.plan.name,
              downloadMbps: currentSubscription.plan.downloadMbps,
              uploadMbps: currentSubscription.plan.uploadMbps,
              monthlyCents: currentSubscription.plan.monthlyCents,
            },
          }
        : null,
      outstandingInvoiceCents: outstanding._sum.totalCents ?? 0,
      latestInvoice: latestInvoice
        ? {
            id: latestInvoice.id,
            invoiceNumber: latestInvoice.invoiceNumber,
            issueDate: latestInvoice.issueDate,
            dueDate: latestInvoice.dueDate,
            totalCents: latestInvoice.totalCents,
            status: latestInvoice.status,
            payment: latestInvoice.payments[0]
              ? {
                  amountCents: latestInvoice.payments[0].amountCents,
                  status: latestInvoice.payments[0].status,
                  paidAt: latestInvoice.payments[0].paidAt,
                }
              : null,
          }
        : null,
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        totalCents: invoice.totalCents,
        status: invoice.status,
        paymentStatus: invoice.payments[0]?.status ?? null,
      })),
    };
  }
}
