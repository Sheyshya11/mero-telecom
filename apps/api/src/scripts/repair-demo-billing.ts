import {
  BillingCycle,
  BillingMode,
  InvoiceStatus,
  InvoiceType,
  PlanChangeStatus,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';

import { BillingService } from '../modules/billing/billing.service';
import { assertNonProductionDatabaseCommand } from './database-command-safety';

const demoEmail = 'customer@merotelecom.test';
const pendingStatuses = [
  PlanChangeStatus.PENDING,
  PlanChangeStatus.CHECKOUT_CREATED,
  PlanChangeStatus.PROCESSING,
  PlanChangeStatus.SCHEDULED,
];

export function assertLocalDemoRepair(environment: string | undefined, databaseUrl: string) {
  assertNonProductionDatabaseCommand(environment, 'Demo billing repair');
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('Demo billing repair requires a local PostgreSQL database.');
  }
}

// This repairs a presentation fixture only. It does not renew real subscriptions,
// settle invoices, create payments, or contact Stripe.
export async function repairDemoBilling(prisma: PrismaClient, apply = false, now = new Date()) {
  const billing = new BillingService();
  return prisma.$transaction(
    async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { email: demoEmail } });
      const services = await tx.subscription.findMany({
        where: { customerId: customer.id, status: SubscriptionStatus.ACTIVE },
      });
      if (services.length !== 1) throw new Error('Expected exactly one active demo subscription.');
      const subscriptionId = services[0]!.id;
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId}::uuid FOR UPDATE`;
      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: {
          sourcePlanChanges: {
            where: { status: { in: pendingStatuses } },
            include: { invoice: { include: { payments: true } } },
          },
        },
      });
      if (
        subscription.status !== SubscriptionStatus.ACTIVE ||
        subscription.billingMode !== BillingMode.MANUAL ||
        subscription.billingCycle !== BillingCycle.MONTHLY ||
        subscription.stripeSubscriptionId ||
        subscription.cancelAtPeriodEnd ||
        subscription.currentPeriodEnd <= subscription.currentPeriodStart
      ) {
        throw new Error('The demo subscription is not safe for a manual fixture repair.');
      }
      if (subscription.currentPeriodEnd > now) return { changed: false, subscriptionId };
      const staleQuotes = subscription.sourcePlanChanges;
      for (const quote of staleQuotes) {
        if (
          quote.status !== PlanChangeStatus.PENDING ||
          quote.currentPeriodEndSnapshot > now ||
          quote.stripeCheckoutSessionId ||
          quote.stripePaymentIntentId ||
          quote.paymentId ||
          !quote.invoice ||
          quote.invoice.type !== InvoiceType.PLAN_CHANGE ||
          ![InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE].includes(
            quote.invoice.status as 'ISSUED' | 'OVERDUE',
          ) ||
          quote.invoice.paidAt ||
          quote.invoice.stripeInvoiceId ||
          quote.invoice.payments.length
        ) {
          throw new Error('A plan change needs reconciliation before the demo can be refreshed.');
        }
      }
      const quoteInvoiceIds = staleQuotes.map((quote) => quote.invoiceId!);
      const blockers = await Promise.all([
        tx.invoice.count({
          where: {
            customerId: customer.id,
            status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
            id: { notIn: quoteInvoiceIds },
          },
        }),
        tx.cancellationRequest.count({
          where: { subscriptionId, status: { notIn: ['REJECTED', 'COMPLETED', 'REVOKED'] } },
        }),
        tx.serviceRelocation.count({
          where: {
            subscriptionId,
            status: { notIn: ['REJECTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'FORCE_CLOSED'] },
          },
        }),
        tx.recurringSetupAttempt.count({
          where: { subscriptionId, status: { in: ['PENDING', 'CHECKOUT_CREATED', 'PROCESSING'] } },
        }),
      ]);
      if (blockers.some(Boolean)) {
        throw new Error('Outstanding billing or lifecycle activity needs review before repair.');
      }
      let start = subscription.currentPeriodStart;
      let end = subscription.currentPeriodEnd;
      while (end <= now) {
        start = end;
        end = billing.nextMonthlyBoundary(start, subscription.billingAnchorDay);
      }
      const result = {
        changed: true,
        applied: apply,
        subscriptionId,
        before: {
          start: subscription.currentPeriodStart.toISOString(),
          end: subscription.currentPeriodEnd.toISOString(),
        },
        after: { start: start.toISOString(), end: end.toISOString() },
        expiredQuoteIds: staleQuotes.map((quote) => quote.id),
        cancelledInvoiceIds: quoteInvoiceIds,
      };
      if (!apply) return result;
      for (const quote of staleQuotes) {
        await tx.planChangeRequest.update({
          where: { id: quote.id },
          data: {
            status: PlanChangeStatus.EXPIRED,
            failureReason: 'The previous billing period ended',
          },
        });
        await tx.invoice.update({
          where: { id: quote.invoiceId! },
          data: { status: InvoiceStatus.CANCELLED },
        });
      }
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { currentPeriodStart: start, currentPeriodEnd: end },
      });
      await tx.auditLog.create({
        data: {
          action: 'DEMO_BILLING_PERIOD_REFRESHED',
          entityType: 'Subscription',
          entityId: subscriptionId,
          metadata: result,
        },
      });
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main() {
  config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
  config({ path: resolve(process.cwd(), '.env'), quiet: true });
  assertLocalDemoRepair(process.env.NODE_ENV, process.env.DATABASE_URL ?? '');
  const prisma = new PrismaClient();
  try {
    console.log(
      JSON.stringify(await repairDemoBilling(prisma, process.argv.includes('--apply')), null, 2),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Demo billing repair failed.');
    process.exitCode = 1;
  });
}
