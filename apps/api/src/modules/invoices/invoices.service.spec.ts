import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import { BillingService } from '../billing/billing.service';
import { InvoicesService } from './invoices.service';

describe('InvoicesService subscription pricing', () => {
  it('uses the subscription price snapshot after the catalogue price changes', async () => {
    const createdInvoice = { id: 'invoice-id', totalCents: 6900 };
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'subscription-id',
          customerId: 'customer-id',
          status: SubscriptionStatus.ACTIVE,
          monthlyCents: 6900,
          plan: { name: 'Essential 50', monthlyCents: 7900 },
          customer: {},
        }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdInvoice),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: unknown) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new InvoicesService(
      prisma as unknown as PrismaService,
      new BillingService(),
      {} as never,
      { invalidate: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(
      service.generate({ subscriptionId: 'subscription-id', issueDate: '2026-09-01' }),
    ).resolves.toBe(createdInvoice);

    expect(transaction.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotalCents: 6273,
          taxCents: 627,
          totalCents: 6900,
          status: InvoiceStatus.ISSUED,
        }),
      }),
    );
  });
});
