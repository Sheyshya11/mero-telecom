import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';
import { PaymentsService } from './payments.service';

interface StripeWebhookJob {
  event: Stripe.Event;
}

@Injectable()
export class StripeWebhookQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StripeWebhookQueueService.name);
  private readonly queueName = 'mero-telecom-stripe-webhooks';
  private readonly redisUrl: string;
  private readonly inlineProcessing: boolean;
  private queue?: Queue<StripeWebhookJob, void, 'PROCESS_STRIPE_WEBHOOK'>;
  private worker?: Worker<StripeWebhookJob, void, 'PROCESS_STRIPE_WEBHOOK'>;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly payments: PaymentsService,
  ) {
    this.redisUrl = config.getOrThrow('redis').url;
    this.inlineProcessing = config.getOrThrow('app').environment === 'test';
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
    });
    this.worker = new Worker(
      this.queueName,
      async (job) => this.payments.processStripeEvent(job.data.event),
      {
        connection: { url: this.redisUrl, maxRetriesPerRequest: null },
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) => {
      const attempts = typeof job?.opts.attempts === 'number' ? job.opts.attempts : 1;
      const exhausted = Boolean(job && job.attemptsMade >= attempts);
      this.logger.error(
        JSON.stringify({
          event: exhausted ? 'stripe_webhook_dead_lettered' : 'stripe_webhook_processing_failed',
          eventId: job?.data.event.id,
          eventType: job?.data.event.type,
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'stripe_webhook_worker_error', error: error.name }),
      );
    });
  }

  async enqueue(payload: Buffer, signature: string | undefined): Promise<Stripe.Event> {
    const event = this.payments.constructStripeWebhookEvent(payload, signature);
    if (this.inlineProcessing) {
      await this.payments.processStripeEvent(event);
      return event;
    }
    if (!this.queue) {
      throw new ServiceUnavailableException('Stripe webhook processing is not ready.');
    }
    await this.queue.add(
      'PROCESS_STRIPE_WEBHOOK',
      { event },
      {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
        removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
      },
    );
    return event;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
