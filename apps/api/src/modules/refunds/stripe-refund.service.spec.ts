import { RefundReason } from '@prisma/client';

import { StripeRefundService } from './stripe-refund.service';

describe('StripeRefundService', () => {
  it('submits integer cents, internal metadata, and an attempt-scoped idempotency key', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_test' });
    const service = new StripeRefundService({ client: { refunds: { create } } } as never);
    await service.create({
      refundId: 'refund-1',
      paymentIntentId: 'pi_test',
      amountCents: 4_000,
      reason: RefundReason.DUPLICATE_PAYMENT,
      customerId: 'customer-1',
      paymentId: 'payment-1',
      invoiceId: 'invoice-1',
      processingAttempt: 2,
    });
    expect(create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_test',
        amount: 4_000,
        reason: 'duplicate',
        metadata: {
          meroRefundId: 'refund-1',
          customerId: 'customer-1',
          paymentId: 'payment-1',
          invoiceId: 'invoice-1',
        },
      },
      { idempotencyKey: 'mero-refund-refund-1-2' },
    );
  });

  it('maps internal non-duplicate reasons to Stripe requested_by_customer', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_test' });
    const service = new StripeRefundService({ client: { refunds: { create } } } as never);
    await service.create({
      refundId: 'refund-2',
      paymentIntentId: 'pi_test',
      amountCents: 1,
      reason: RefundReason.GOODWILL,
      customerId: 'customer-1',
      paymentId: 'payment-1',
      processingAttempt: 1,
    });
    expect(create.mock.calls[0][0].reason).toBe('requested_by_customer');
  });

  it('uses a stable cancellation idempotency key across processing retries', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_test' });
    const service = new StripeRefundService({ client: { refunds: { create } } } as never);
    await service.create({
      refundId: 'refund-3',
      paymentIntentId: 'pi_test',
      amountCents: 2_500,
      reason: RefundReason.CANCELLATION_PRORATION,
      customerId: 'customer-1',
      paymentId: 'payment-1',
      processingAttempt: 4,
      idempotencyKey: 'cancellation-refund-cancellation-1',
    });
    expect(create.mock.calls[0][1]).toEqual({
      idempotencyKey: 'cancellation-refund-cancellation-1',
    });
  });
});
