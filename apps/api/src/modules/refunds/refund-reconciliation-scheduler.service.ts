import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import type { AppConfig } from '../../config/configuration';
import { NotificationService } from '../notifications/notification.service';
import { RefundsService } from './refunds.service';

type RefundReconciliationJob = Record<string, never>;
type RefundReconciliationJobName = 'RECONCILE_STALE_REFUNDS';

/** Periodically repairs refunds whose Stripe webhook was missed or delayed. */
@Injectable()
export class RefundReconciliationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundReconciliationSchedulerService.name);
  private readonly redisUrl: string;
  private readonly intervalMilliseconds: number;
  private readonly staleAfterMilliseconds: number;
  private readonly batchSize: number;
  private readonly queueName = 'mero-telecom-refund-reconciliation';
  private queue?: Queue<RefundReconciliationJob, unknown, RefundReconciliationJobName>;
  private worker?: Worker<RefundReconciliationJob, unknown, RefundReconciliationJobName>;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationService,
  ) {
    this.redisUrl = configService.getOrThrow('redis').url;
    const config = configService.getOrThrow('refundReconciliation');
    this.intervalMilliseconds = config.intervalMilliseconds;
    this.staleAfterMilliseconds = config.staleAfterMilliseconds;
    this.batchSize = config.batchSize;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<RefundReconciliationJob, unknown, RefundReconciliationJobName>(
      this.queueName,
      { connection: { url: this.redisUrl, maxRetriesPerRequest: 1 } },
    );
    this.worker = new Worker<RefundReconciliationJob, unknown, RefundReconciliationJobName>(
      this.queueName,
      async () => {
        const summary = await this.refunds.reconcileStaleProcessingRefunds(
          new Date(Date.now() - this.staleAfterMilliseconds),
          this.batchSize,
        );
        for (const issue of summary.issues) {
          try {
            await this.notifications.sendRefundReconciliationAlert(issue);
          } catch (error: unknown) {
            this.logger.error(
              JSON.stringify({
                event: 'refund.reconciliation_alert_failed',
                refundId: issue.refundId,
                error: error instanceof Error ? error.name : 'UnknownError',
              }),
            );
          }
        }
        return summary;
      },
      { connection: { url: this.redisUrl, maxRetriesPerRequest: null }, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'refund.reconciliation_job_failed',
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'refund.reconciliation_worker_error', error: error.name }),
      );
    });
    await this.queue.add(
      'RECONCILE_STALE_REFUNDS',
      {},
      {
        jobId: 'scheduled-refund-reconciliation',
        repeat: { every: this.intervalMilliseconds },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    );
    await this.queue.add(
      'RECONCILE_STALE_REFUNDS',
      {},
      {
        jobId: `scheduled-refund-reconciliation-startup-${process.pid}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 100 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
