import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentProvider, RefundStatus } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import type { ReconciliationStatus, ResolvedReportPeriod } from '../billing-report.types';
import type { BillingReportQueryDto } from '../dto/billing-report-query.dto';
import { SETTLED_PAYMENT_STATUSES } from './financial-metrics.service';

@Injectable()
export class ReconciliationReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: BillingReportQueryDto, period: ResolvedReportPeriod) {
    const payments = await this.prisma.payment.findMany({
      where: {
        createdAt: { gte: period.from, lt: period.to },
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.paymentStatus ? { status: query.paymentStatus } : {}),
      },
      orderBy: { createdAt: query.sortDirection },
      include: {
        invoice: {
          select: { invoiceNumber: true, totalCents: true, currency: true, status: true },
        },
        webhookEvents: { select: { providerEventId: true, eventType: true, processedAt: true } },
        refunds: {
          select: {
            id: true,
            status: true,
            refundAmountCents: true,
            stripeRefundId: true,
            webhookEvents: { select: { providerEventId: true, processedAt: true } },
          },
        },
      },
    });
    const data = payments.map((payment) => {
      const issues: string[] = [];
      let result: ReconciliationStatus = 'MATCHED';
      if (payment.provider === PaymentProvider.STRIPE && !payment.providerPaymentId) {
        result = 'MISSING_EXTERNAL';
        issues.push('Stripe payment identifier is missing.');
      } else if (
        payment.provider === PaymentProvider.STRIPE &&
        SETTLED_PAYMENT_STATUSES.includes(payment.status) &&
        payment.webhookEvents.length === 0
      ) {
        result = 'NEEDS_REVIEW';
        issues.push('No linked Stripe webhook evidence was recorded.');
      }
      if (payment.currency !== payment.invoice.currency) {
        result = 'MISMATCH';
        issues.push('Payment and invoice currencies differ.');
      }
      if (
        SETTLED_PAYMENT_STATUSES.includes(payment.status) &&
        payment.invoice.status !== InvoiceStatus.PAID
      ) {
        result = 'MISMATCH';
        issues.push('Payment succeeded but the invoice is not marked paid.');
      }
      for (const refund of payment.refunds) {
        if (refund.status !== RefundStatus.SUCCEEDED) continue;
        if (!refund.stripeRefundId || refund.webhookEvents.length === 0) {
          result = 'MISSING_EXTERNAL';
          issues.push('A completed local refund lacks Stripe webhook evidence.');
        }
      }
      const refundCents = payment.refunds
        .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
        .reduce((sum, refund) => sum + refund.refundAmountCents, 0);
      const lastEvidenceAt =
        [...payment.webhookEvents, ...payment.refunds.flatMap((row) => row.webhookEvents)]
          .map((event) => event.processedAt)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
      return {
        paymentId: payment.id,
        invoiceNumber: payment.invoice.invoiceNumber,
        stripePaymentIntentId: payment.providerPaymentId,
        internalPaymentAmountCents: payment.amountCents,
        internalRefundAmountCents: refundCents,
        currency: payment.currency,
        internalStatus: payment.status,
        invoiceStatus: payment.invoice.status,
        externalEvidence: payment.webhookEvents.length ? 'STRIPE_WEBHOOK_RECORDED' : 'NOT_RECORDED',
        lastEvidenceAt,
        result,
        issues,
      };
    });
    const start = (query.page - 1) * query.pageSize;
    const latestEvidence = data
      .map((row) => row.lastEvidenceAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const matchedCount = data.filter((row) => row.result === 'MATCHED').length;
    return {
      data: data.slice(start, start + query.pageSize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: data.length,
        totalPages: Math.ceil(data.length / query.pageSize),
      },
      summary: {
        matchedCount,
        exceptionCount: data.length - matchedCount,
        totalChecked: data.length,
        lastReconciledAt: latestEvidence?.toISOString() ?? null,
      },
      scope: 'RECORDED_STRIPE_EVIDENCE',
    };
  }
}
