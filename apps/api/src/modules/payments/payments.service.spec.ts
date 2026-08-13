import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Role } from '@prisma/client';
import type Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { PaymentsService } from './payments.service';

const stripeSecret = 'whsec_phase13_test_secret';
const invoiceId = '6b34d995-21a6-4d36-8e28-1f465f93cc66';
const customerId = '46ed2dc1-1ff8-4649-8440-1aa4355b97ad';

function makeService(prisma: Partial<PrismaService>) {
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'stripe')
        return { secretKey: 'sk_test_phase13_unit_test', webhookSecret: stripeSecret };
      return { frontendUrl: 'http://localhost:3000' };
    }),
  };
  return new PaymentsService(
    prisma as PrismaService,
    configService as never,
    {
      invalidate: jest.fn().mockResolvedValue(true),
    } as never,
  );
}

describe('PaymentsService', () => {
  it('creates Checkout from server-side invoice values and never caller-supplied money', async () => {
    const prisma = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          invoiceNumber: 'INV-2026-000002',
          totalCents: 6900,
          currency: 'AUD',
          status: InvoiceStatus.ISSUED,
          customer: { email: 'customer@merotelecom.test' },
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'payment-id' }),
      },
    };
    const service = makeService(prisma);
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.test/123' });
    (stripe as unknown as { checkout: { sessions: { create: jest.Mock } } }).checkout = {
      sessions: { create },
    };

    await expect(
      service.createCheckoutSession(invoiceId, {
        id: 'customer-user-id',
        email: 'customer@merotelecom.test',
        role: Role.CUSTOMER,
      }),
    ).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.test/123',
      paymentId: 'payment-id',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: invoiceId,
        integration_identifier: expect.stringMatching(/^mero_telecom_invoice_[a-z]{8}$/),
        metadata: { invoiceId, customerId },
        line_items: [
          expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 6900 }) }),
        ],
      }),
      { idempotencyKey: expect.stringMatching(new RegExp(`^invoice-checkout-${invoiceId}-`)) },
    );
  });

  it('verifies a signed event and handles a repeated event without duplicate updates', async () => {
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'already-processed' }),
        create: jest.fn().mockResolvedValue({ id: 'event-row-id' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          totalCents: 6900,
          currency: 'AUD',
        }),
        update: jest.fn().mockResolvedValue({ id: invoiceId, status: InvoiceStatus.PAID }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-id',
          invoiceId,
          customerId,
          status: PaymentStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue({ id: 'payment-id', status: PaymentStatus.SUCCEEDED }),
      },
    };
    const prisma = { $transaction: jest.fn((operation) => operation(transaction)) };
    const service = makeService(prisma);
    const payload = JSON.stringify({
      id: 'evt_phase13_001',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 6900,
          currency: 'aud',
          client_reference_id: invoiceId,
          payment_intent: 'pi_test_123',
          metadata: { invoiceId, customerId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);
    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.payment.update).toHaveBeenCalledTimes(1);
    expect(transaction.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: InvoiceStatus.PAID }) }),
    );
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledTimes(1);
  });

  it('records a distinct valid event for an already-succeeded Checkout Session', async () => {
    const transaction = {
      paymentWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'second-event-row' }),
      },
      invoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: invoiceId,
          customerId,
          totalCents: 6900,
          currency: 'AUD',
        }),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-id',
          invoiceId,
          customerId,
          status: PaymentStatus.SUCCEEDED,
        }),
        update: jest.fn(),
      },
    };
    const service = makeService({
      $transaction: jest.fn((operation) => operation(transaction)),
    } as never);
    const payload = JSON.stringify({
      id: 'evt_phase16_distinct',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 6900,
          currency: 'aud',
          client_reference_id: invoiceId,
          metadata: { invoiceId, customerId },
        },
      },
    });
    const stripe = (service as unknown as { stripe: Stripe }).stripe;
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeSecret });

    await service.processStripeWebhook(Buffer.from(payload), signature);

    expect(transaction.payment.update).not.toHaveBeenCalled();
    expect(transaction.invoice.update).not.toHaveBeenCalled();
    expect(transaction.paymentWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: 'payment-id' }) }),
    );
  });

  it('rejects an event whose signature cannot be verified', async () => {
    const service = makeService({});
    await expect(
      service.processStripeWebhook(Buffer.from('{"id":"evt_invalid"}'), 't=1,v1=invalid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
