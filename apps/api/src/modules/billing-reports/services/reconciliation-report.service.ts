import { Injectable } from '@nestjs/common';
import {
  AccountTransactionType,
  AccountTransactionStatus,
  InvoiceStatus,
  PaymentProvider,
  RefundStatus,
  StripeSyncStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

import { PrismaService } from '../../../database/prisma.service';
import { StripeClientService } from '../../payments/stripe-client.service';
import type { ReconciliationStatus, ResolvedReportPeriod } from '../billing-report.types';
import type { BillingReportQueryDto } from '../dto/billing-report-query.dto';
import { SETTLED_PAYMENT_STATUSES } from './financial-metrics.service';

@Injectable()
export class ReconciliationReportService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    stripeClient: StripeClientService,
  ) {
    this.stripe = stripeClient.client;
  }

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
        payment.amountCents !== payment.invoice.totalCents
      ) {
        result = 'MISMATCH';
        issues.push('Stripe payment amount and local invoice amount differ.');
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
    const accountTransactions = this.prisma.accountTransaction
      ? await this.prisma.accountTransaction.findMany({
          where: {
            createdAt: { gte: period.from, lt: period.to },
            ...(query.customerId ? { customerId: query.customerId } : {}),
          },
          include: {
            applications: { select: { amountCents: true } },
            customer: { select: { stripeCustomerId: true } },
          },
          orderBy: { createdAt: query.sortDirection },
        })
      : [];
    const ledgerChecks = await Promise.all(
      accountTransactions.map(async (transaction) => {
        const issues: string[] = [];
        const appliedCents = transaction.applications.reduce(
          (sum, application) => sum + application.amountCents,
          0,
        );
        if (
          transaction.stripeSyncStatus === StripeSyncStatus.SYNCED &&
          !transaction.stripeBalanceTransactionId
        ) {
          issues.push('Synced adjustment has no recorded Stripe balance transaction.');
        }
        if (transaction.stripeSyncStatus === StripeSyncStatus.FAILED) {
          issues.push('Adjustment synchronization with Stripe failed.');
        }
        if (
          transaction.stripeSyncStatus === StripeSyncStatus.SYNCED &&
          transaction.stripeBalanceTransactionId
        ) {
          if (!transaction.customer.stripeCustomerId) {
            issues.push('Synced adjustment has no Stripe customer reference.');
          } else {
            try {
              const remote = await this.stripe.customers.retrieveBalanceTransaction(
                transaction.customer.stripeCustomerId,
                transaction.stripeBalanceTransactionId,
              );
              const expectedAmount =
                transaction.type === AccountTransactionType.CREDIT
                  ? -transaction.amountCents
                  : transaction.amountCents;
              if (
                remote.amount !== expectedAmount ||
                remote.currency.toUpperCase() !== transaction.currency
              ) {
                issues.push('Stripe adjustment amount or currency differs from the local ledger.');
              }
            } catch {
              issues.push('Recorded Stripe balance transaction could not be verified.');
            }
          }
        }
        if (
          transaction.remainingAmountCents < 0 ||
          transaction.remainingAmountCents > transaction.amountCents
        ) {
          issues.push('Remaining adjustment amount is outside its valid range.');
        }
        if (appliedCents > transaction.amountCents) {
          issues.push('Applied adjustment amount exceeds the original adjustment.');
        }
        if (
          transaction.status === AccountTransactionStatus.REFUNDED &&
          transaction.remainingAmountCents > 0
        ) {
          issues.push('Refunded credit still has an available amount.');
        }
        if (
          transaction.status === AccountTransactionStatus.USED &&
          transaction.remainingAmountCents !== 0
        ) {
          issues.push('Used adjustment has a non-zero remaining amount.');
        }
        return issues.length
          ? {
              accountTransactionId: transaction.id,
              customerId: transaction.customerId,
              type: transaction.type,
              reason: transaction.reason,
              amountCents: transaction.amountCents,
              remainingAmountCents: transaction.remainingAmountCents,
              appliedCents,
              stripeSyncStatus: transaction.stripeSyncStatus,
              stripeBalanceTransactionId: transaction.stripeBalanceTransactionId,
              result: 'NEEDS_REVIEW' as const,
              issues,
            }
          : null;
      }),
    );
    const ledgerExceptions = ledgerChecks.filter(
      (row): row is NonNullable<(typeof ledgerChecks)[number]> => row !== null,
    );
    const start = (query.page - 1) * query.pageSize;
    const latestEvidence = data
      .map((row) => row.lastEvidenceAt)
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const matchedCount =
      data.filter((row) => row.result === 'MATCHED').length +
      accountTransactions.length -
      ledgerExceptions.length;
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
        exceptionCount: data.length - matchedCount + ledgerExceptions.length,
        totalChecked: data.length + accountTransactions.length,
        lastReconciledAt: latestEvidence?.toISOString() ?? null,
      },
      ledgerExceptions,
      scope: 'LIVE_STRIPE_AND_RECORDED_EVIDENCE',
    };
  }
}
