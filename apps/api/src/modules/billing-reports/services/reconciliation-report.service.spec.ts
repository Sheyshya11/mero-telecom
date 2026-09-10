import { InvoiceStatus, PaymentProvider, PaymentStatus } from '@prisma/client';

import { ReconciliationReportService } from './reconciliation-report.service';

describe('ReconciliationReportService', () => {
  it('flags a succeeded payment when invoice state disagrees', async () => {
    const prisma = {
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
    const service = new ReconciliationReportService(prisma as never);
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
});
