import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  PaymentStatus,
  PlanChangeStatus,
  Prisma,
  RefundStatus,
  SubscriptionStatus,
} from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import type { ResolvedReportPeriod } from '../billing-report.types';
import type { BillingReportQueryDto } from '../dto/billing-report-query.dto';
import { BillingReportCalculationsService } from './billing-report-calculations.service';

export const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

const VALID_ISSUED_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
  InvoiceStatus.OVERDUE,
];

type PeriodTotals = {
  grossBilledCents: number;
  paymentsReceivedCents: number;
  refundsPaidCents: number;
  creditsIssuedCents: number;
  gstBilledCents: number;
  gstOnPaymentsCents: number;
  gstRefundedOrCreditedCents: number;
  invoiceCount: number;
  paidInvoiceCount: number;
  failedPaymentCount: number;
  successfulPaymentCount: number;
  refundCount: number;
  creditCount: number;
};

@Injectable()
export class FinancialMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculations: BillingReportCalculationsService,
  ) {}

  async overview(query: BillingReportQueryDto, period: ResolvedReportPeriod) {
    const currentRange = { from: period.from, to: period.to };
    const previousRange = { from: period.previousFrom, to: period.previousTo };
    const [current, previous, snapshot, previousSnapshot] = await Promise.all([
      this.periodTotals(query, currentRange),
      this.periodTotals(query, previousRange),
      this.snapshotTotals(query, period.to),
      this.snapshotTotals(query, period.from),
    ]);

    const netCash = this.calculations.netCashCollected(
      current.paymentsReceivedCents,
      current.refundsPaidCents,
    );
    const previousNetCash = this.calculations.netCashCollected(
      previous.paymentsReceivedCents,
      previous.refundsPaidCents,
    );
    const netBilled = this.calculations.netBilled(
      current.grossBilledCents,
      current.creditsIssuedCents,
    );
    const previousNetBilled = this.calculations.netBilled(
      previous.grossBilledCents,
      previous.creditsIssuedCents,
    );

    return {
      metrics: {
        grossBilled: this.calculations.money(current.grossBilledCents, previous.grossBilledCents),
        paymentsReceived: this.calculations.money(
          current.paymentsReceivedCents,
          previous.paymentsReceivedCents,
        ),
        outstanding: this.calculations.money(
          snapshot.outstandingCents,
          previousSnapshot.outstandingCents,
        ),
        netCashCollected: this.calculations.money(netCash, previousNetCash),
        netBilled: this.calculations.money(netBilled, previousNetBilled),
        mrr: this.calculations.money(snapshot.mrrCents, previousSnapshot.mrrCents),
        activeServices: this.calculations.count(
          snapshot.activeServices,
          previousSnapshot.activeServices,
        ),
        arpu: this.calculations.money(
          this.calculations.arpu(snapshot.mrrCents, snapshot.activeServices),
          this.calculations.arpu(previousSnapshot.mrrCents, previousSnapshot.activeServices),
        ),
        overdueBalance: this.calculations.money(
          snapshot.overdueAmountCents,
          previousSnapshot.overdueAmountCents,
        ),
        failedPayments: this.calculations.count(
          current.failedPaymentCount,
          previous.failedPaymentCount,
        ),
        refundsPaid: this.calculations.money(current.refundsPaidCents, previous.refundsPaidCents),
        creditsIssued: this.calculations.money(
          current.creditsIssuedCents,
          previous.creditsIssuedCents,
        ),
      },
      tax: {
        gstBilledCents: current.gstBilledCents,
        gstAssociatedWithPaymentsCents: current.gstOnPaymentsCents,
        gstRefundedOrCreditedCents: current.gstRefundedOrCreditedCents,
      },
      overdue: {
        invoiceCount: snapshot.overdueInvoiceCount,
        customerCount: snapshot.overdueCustomerCount,
        totalAmountCents: snapshot.overdueAmountCents,
        averageDaysOverdue: snapshot.averageDaysOverdue,
        oldestInvoiceAgeDays: snapshot.oldestInvoiceAgeDays,
      },
      paymentHealth: {
        successfulPaymentCount: current.successfulPaymentCount,
        successfulPaymentValueCents: current.paymentsReceivedCents,
        failedPaymentCount: current.failedPaymentCount,
        paymentSuccessRate: this.calculations.successRate(
          current.successfulPaymentCount,
          current.failedPaymentCount,
        ),
        averagePaymentValueCents:
          current.successfulPaymentCount === 0
            ? 0
            : Math.round(current.paymentsReceivedCents / current.successfulPaymentCount),
        refundCount: current.refundCount,
        refundValueCents: current.refundsPaidCents,
        creditCount: current.creditCount,
        creditValueCents: current.creditsIssuedCents,
      },
      // Compatibility aliases for existing consumers. Names with ambiguous semantics are removed.
      totalInvoices: current.invoiceCount,
      grossAmountCents: current.grossBilledCents,
      paymentsReceivedCents: current.paymentsReceivedCents,
      outstandingBalanceCents: snapshot.outstandingCents,
      refundAmountCents: current.refundsPaidCents,
      creditsAppliedCents: current.creditsIssuedCents,
      gstBilledCents: current.gstBilledCents,
      netCashCollectedCents: netCash,
      paidInvoices: current.paidInvoiceCount,
      overdueInvoices: snapshot.overdueInvoiceCount,
      failedPayments: current.failedPaymentCount,
      activeSubscriptions: snapshot.activeServices,
      mrrCents: snapshot.mrrCents,
      arpuCents: this.calculations.arpu(snapshot.mrrCents, snapshot.activeServices),
    };
  }

  private async periodTotals(
    query: BillingReportQueryDto,
    range: { from: Date; to: Date },
  ): Promise<PeriodTotals> {
    const invoiceWhere = this.issuedInvoiceWhere(query, range);
    const paymentWhere = this.paymentWhere(query, range, true);
    const failedWhere = this.paymentWhere(query, range, false);
    const refundWhere = this.refundWhere(query, range);
    const creditWhere: Prisma.PlanChangeRequestWhereInput = {
      status: PlanChangeStatus.APPLIED,
      unusedCreditCents: { gt: 0 },
      appliedAt: { gte: range.from, lt: range.to },
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.planId
        ? { OR: [{ sourcePlanId: query.planId }, { targetPlanId: query.planId }] }
        : {}),
    };
    const [invoices, payments, refunds, credits, failedPaymentCount, paidInvoiceCount] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: invoiceWhere,
          select: { totalCents: true, taxCents: true },
        }),
        this.prisma.payment.findMany({
          where: paymentWhere,
          select: {
            amountCents: true,
            invoice: { select: { taxCents: true, totalCents: true } },
          },
        }),
        this.prisma.refund.findMany({
          where: refundWhere,
          select: {
            refundAmountCents: true,
            invoice: { select: { taxCents: true, totalCents: true } },
          },
        }),
        this.prisma.planChangeRequest.findMany({
          where: creditWhere,
          select: { unusedCreditCents: true },
        }),
        this.prisma.payment.count({
          where: { ...failedWhere, status: PaymentStatus.FAILED },
        }),
        this.prisma.invoice.count({ where: { ...invoiceWhere, status: InvoiceStatus.PAID } }),
      ]);
    const grossBilledCents = invoices.reduce((sum, row) => sum + row.totalCents, 0);
    const paymentsReceivedCents = payments.reduce((sum, row) => sum + row.amountCents, 0);
    const refundsPaidCents = refunds.reduce((sum, row) => sum + row.refundAmountCents, 0);
    const creditsIssuedCents = credits.reduce((sum, row) => sum + row.unusedCreditCents, 0);
    return {
      grossBilledCents,
      paymentsReceivedCents,
      refundsPaidCents,
      creditsIssuedCents,
      gstBilledCents: invoices.reduce((sum, row) => sum + row.taxCents, 0),
      gstOnPaymentsCents: payments.reduce(
        (sum, row) =>
          sum +
          this.calculations.proportionalGst(
            row.amountCents,
            row.invoice.taxCents,
            row.invoice.totalCents,
          ),
        0,
      ),
      gstRefundedOrCreditedCents:
        refunds.reduce(
          (sum, row) =>
            sum +
            this.calculations.proportionalGst(
              row.refundAmountCents,
              row.invoice?.taxCents ?? 0,
              row.invoice?.totalCents ?? 0,
            ),
          0,
        ) +
        credits.reduce(
          (sum, row) => sum + this.calculations.gstFromInclusive(row.unusedCreditCents),
          0,
        ),
      invoiceCount: invoices.length,
      paidInvoiceCount,
      failedPaymentCount,
      successfulPaymentCount: payments.length,
      refundCount: refunds.length,
      creditCount: credits.length,
    };
  }

  private async snapshotTotals(query: BillingReportQueryDto, asOfExclusive: Date) {
    const finalLocalServiceDate = new Date(
      `${asOfExclusive.toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: VALID_ISSUED_INVOICE_STATUSES },
        issueDate: { lt: asOfExclusive },
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.planId
          ? { OR: [{ purchasePlanId: query.planId }, { subscription: { planId: query.planId } }] }
          : {}),
      },
      select: {
        totalCents: true,
        dueDate: true,
        customerId: true,
        paidAt: true,
        payments: {
          where: { status: { in: SETTLED_PAYMENT_STATUSES }, paidAt: { lt: asOfExclusive } },
          select: { amountCents: true },
        },
      },
    });
    const asOf = new Date(asOfExclusive.getTime() - 1);
    let outstandingCents = 0;
    let overdueAmountCents = 0;
    let overdueInvoiceCount = 0;
    let totalDaysOverdue = 0;
    let oldestInvoiceAgeDays = 0;
    const overdueCustomers = new Set<string>();
    for (const invoice of invoices) {
      const linkedPaymentTotal = invoice.payments.reduce(
        (sum, payment) => sum + payment.amountCents,
        0,
      );
      // Some legitimate legacy/admin payment flows pre-date linked Payment rows. A paidAt
      // timestamp is still authoritative evidence that the invoice was settled by this snapshot.
      const paid =
        invoice.paidAt && invoice.paidAt < asOfExclusive ? invoice.totalCents : linkedPaymentTotal;
      const remaining = Math.max(0, invoice.totalCents - paid);
      if (!remaining) continue;
      outstandingCents += remaining;
      const daysOverdue = Math.max(
        0,
        Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000),
      );
      if (daysOverdue > 0) {
        overdueAmountCents += remaining;
        overdueInvoiceCount += 1;
        totalDaysOverdue += daysOverdue;
        oldestInvoiceAgeDays = Math.max(oldestInvoiceAgeDays, daysOverdue);
        overdueCustomers.add(invoice.customerId);
      }
    }
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        startDate: { lt: asOfExclusive },
        OR: [
          { status: SubscriptionStatus.ACTIVE, endDate: null },
          { status: SubscriptionStatus.ACTIVE, endDate: { gte: finalLocalServiceDate } },
          { status: SubscriptionStatus.CANCELLED, endDate: { gte: finalLocalServiceDate } },
        ],
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.planId ? { planId: query.planId } : {}),
      },
      select: { billingCycle: true, plan: { select: { monthlyCents: true } } },
    });
    // MRR is GST-exclusive recurring plan value. Monthly is currently the only cadence;
    // the switch remains explicit so quarterly/yearly normalization can be added safely.
    const mrrCents = subscriptions.reduce((sum, subscription) => {
      const exclusive =
        subscription.plan.monthlyCents -
        this.calculations.gstFromInclusive(subscription.plan.monthlyCents);
      switch (subscription.billingCycle) {
        case 'MONTHLY':
          return sum + exclusive;
      }
    }, 0);
    return {
      outstandingCents,
      overdueAmountCents,
      overdueInvoiceCount,
      overdueCustomerCount: overdueCustomers.size,
      averageDaysOverdue:
        overdueInvoiceCount === 0
          ? 0
          : Math.round((totalDaysOverdue / overdueInvoiceCount) * 10) / 10,
      oldestInvoiceAgeDays,
      activeServices: subscriptions.length,
      mrrCents,
    };
  }

  issuedInvoiceWhere(
    query: BillingReportQueryDto,
    range: { from: Date; to: Date },
  ): Prisma.InvoiceWhereInput {
    const and: Prisma.InvoiceWhereInput[] = [
      { status: { in: VALID_ISSUED_INVOICE_STATUSES } },
      {
        OR: [
          { issuedAt: { gte: range.from, lt: range.to } },
          { issuedAt: null, issueDate: { gte: range.from, lt: range.to } },
        ],
      },
    ];
    this.addInvoiceFilters(and, query);
    return { AND: and };
  }

  paymentWhere(
    query: BillingReportQueryDto,
    range: { from: Date; to: Date },
    successful: boolean,
  ): Prisma.PaymentWhereInput {
    const and: Prisma.PaymentWhereInput[] = [
      successful
        ? { paidAt: { gte: range.from, lt: range.to }, status: { in: SETTLED_PAYMENT_STATUSES } }
        : { createdAt: { gte: range.from, lt: range.to } },
    ];
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.planId)
      and.push({
        invoice: {
          OR: [{ purchasePlanId: query.planId }, { subscription: { planId: query.planId } }],
        },
      });
    if (query.paymentStatus) and.push({ status: query.paymentStatus });
    if (query.search)
      and.push({
        OR: [
          { providerPaymentId: { contains: query.search, mode: 'insensitive' } },
          { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
  }

  refundWhere(
    query: BillingReportQueryDto,
    range: { from: Date; to: Date },
  ): Prisma.RefundWhereInput {
    const and: Prisma.RefundWhereInput[] = [
      { status: RefundStatus.SUCCEEDED, processedAt: { gte: range.from, lt: range.to } },
    ];
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.planId) and.push({ subscription: { planId: query.planId } });
    if (query.refundStatus) and.push({ status: query.refundStatus });
    if (query.search)
      and.push({
        OR: [
          { stripeRefundId: { contains: query.search, mode: 'insensitive' } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
  }

  private addInvoiceFilters(and: Prisma.InvoiceWhereInput[], query: BillingReportQueryDto): void {
    if (query.customerId) and.push({ customerId: query.customerId });
    if (query.invoiceStatus) and.push({ status: query.invoiceStatus });
    if (query.planId)
      and.push({
        OR: [{ purchasePlanId: query.planId }, { subscription: { planId: query.planId } }],
      });
    if (query.subscriptionStatus) and.push({ subscription: { status: query.subscriptionStatus } });
    if (query.billingCycle) and.push({ subscription: { billingCycle: query.billingCycle } });
    if (query.search)
      and.push({
        OR: [
          { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { firstName: { contains: query.search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
  }
}
