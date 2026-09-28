import {
  AccountTransactionStatus,
  InvoiceStatus,
  PaymentProvider,
  PaymentStatus,
  StripeSyncStatus,
} from '@prisma/client';

import { ReconciliationReportService } from './reconciliation-report.service';

describe('ReconciliationReportService', () => {
  it('flags a succeeded payment when invoice state disagrees', async () => {
    const prisma = {
      accountTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payment-1',
            provider: PaymentProvider.STRIPE,
            providerPaymentId: 'pi_123',
            amountCents: 9_900,
            currency: 'AUD',
            status: PaymentStatus.SUCCEEDED,
            createdAt: new Date(),
            invoice: {
              invoiceNumber: 'INV-1',
              totalCents: 9_900,
              currency: 'AUD',
              status: InvoiceStatus.ISSUED,
            },
            webhookEvents: [
              {
                providerEventId: 'evt_1',
                eventType: 'checkout.session.completed',
                processedAt: new Date('2026-09-08T00:00:00.000Z'),
              },
            ],
            refunds: [],
          },
        ]),
      },
    };
    const service = new ReconciliationReportService(
      prisma as never,
      {
        client: { customers: { retrieveBalanceTransaction: jest.fn() } },
      } as never,
    );
    const result = await service.report(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-10-01T00:00:00.000Z'),
        previousFrom: new Date('2026-08-01T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date(),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-30',
      },
    );
    expect(result.data[0]).toMatchObject({
      result: 'MISMATCH',
      issues: ['Payment succeeded but the invoice is not marked paid.'],
    });
    expect(result.summary).toMatchObject({ matchedCount: 0, exceptionCount: 1, totalChecked: 1 });
  });

  it('flags invalid ledger balances and missing Stripe adjustment evidence', async () => {
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      accountTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'credit-1',
            customerId: 'customer-1',
            type: 'CREDIT',
            reason: 'SERVICE_OUTAGE',
            amountCents: 2_000,
            remainingAmountCents: 2_100,
            status: AccountTransactionStatus.REFUNDED,
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeBalanceTransactionId: null,
            applications: [{ amountCents: 2_500 }],
          },
        ]),
      },
    };
    const service = new ReconciliationReportService(
      prisma as never,
      {
        client: { customers: { retrieveBalanceTransaction: jest.fn() } },
      } as never,
    );
    const result = await service.report(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-10-01T00:00:00.000Z'),
        previousFrom: new Date('2026-08-01T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date(),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-30',
      },
    );

    expect(result.ledgerExceptions[0].issues).toEqual(
      expect.arrayContaining([
        'Synced adjustment has no recorded Stripe balance transaction.',
        'Remaining adjustment amount is outside its valid range.',
        'Applied adjustment amount exceeds the original adjustment.',
        'Refunded credit still has an available amount.',
      ]),
    );
    expect(result.summary).toMatchObject({ exceptionCount: 1, totalChecked: 1 });
  });

  it('flags a locally synced adjustment when Stripe cannot verify the transaction', async () => {
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      accountTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'credit-remote-missing',
            customerId: 'customer-1',
            type: 'CREDIT',
            reason: 'GOODWILL',
            currency: 'AUD',
            amountCents: 1_000,
            remainingAmountCents: 1_000,
            status: AccountTransactionStatus.AVAILABLE,
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeBalanceTransactionId: 'cbtxn_missing',
            customer: { stripeCustomerId: 'cus_123' },
            applications: [],
          },
        ]),
      },
    };
    const retrieveBalanceTransaction = jest.fn().mockRejectedValue(new Error('not found'));
    const service = new ReconciliationReportService(
      prisma as never,
      {
        client: { customers: { retrieveBalanceTransaction } },
      } as never,
    );
    const result = await service.report(
      { page: 1, pageSize: 25, sortBy: 'date', sortDirection: 'desc' },
      {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-10-01T00:00:00.000Z'),
        previousFrom: new Date('2026-08-01T00:00:00.000Z'),
        previousTo: new Date('2026-09-01T00:00:00.000Z'),
        timezone: 'Australia/Adelaide',
        generatedAt: new Date(),
        fromLocalDate: '2026-09-01',
        toLocalDate: '2026-09-30',
      },
    );

    expect(retrieveBalanceTransaction).toHaveBeenCalledWith('cus_123', 'cbtxn_missing');
    expect(result.ledgerExceptions[0].issues).toContain(
      'Recorded Stripe balance transaction could not be verified.',
    );
  });
});
