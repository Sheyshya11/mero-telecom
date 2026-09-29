import { ServiceUnavailableException } from '@nestjs/common';
import type Stripe from 'stripe';

import { StripeWebhookQueueService } from './stripe-webhook-queue.service';

describe('StripeWebhookQueueService', () => {
  const event = {
    id: 'evt_queue_test',
    type: 'invoice.paid',
    data: { object: { id: 'in_queue_test' } },
  } as Stripe.Event;

  function makeService() {
    const payments = {
      constructStripeWebhookEvent: jest.fn().mockReturnValue(event),
      processStripeEvent: jest.fn().mockResolvedValue(undefined),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6380') };
    return {
      payments,
      service: new StripeWebhookQueueService(config as never, payments as never),
    };
  }

  it('verifies the signature before enqueueing a durable retryable job', async () => {
    const { service, payments } = makeService();
    const add = jest.fn().mockResolvedValue({ id: `stripe-${event.id}` });
    (service as unknown as { queue: { add: typeof add } }).queue = { add };
    const payload = Buffer.from('{"id":"evt_queue_test"}');

    await expect(service.enqueue(payload, 'valid-signature')).resolves.toBe(event);

    expect(payments.constructStripeWebhookEvent).toHaveBeenCalledWith(payload, 'valid-signature');
    expect(add).toHaveBeenCalledWith(
      'PROCESS_STRIPE_WEBHOOK',
      { event },
      expect.objectContaining({
        attempts: 8,
        backoff: { type: 'exponential', delay: 1_000 },
      }),
    );
  });

  it('returns a retryable HTTP failure when Redis is unavailable', async () => {
    const { service } = makeService();
    await expect(service.enqueue(Buffer.from('{}'), 'valid-signature')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
