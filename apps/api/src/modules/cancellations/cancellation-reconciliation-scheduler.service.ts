import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import type { AppConfig } from '../../config/configuration';
import { CancellationsService } from './cancellations.service';

type CancellationReconciliationJob = Record<string, never>;
type CancellationReconciliationJobName = 'RECONCILE_CANCELLATIONS';

@Injectable()
export class CancellationReconciliationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CancellationReconciliationSchedulerService.name);
  private readonly redisUrl: string;
  private readonly intervalMilliseconds: number;
  private readonly queueName = 'mero-telecom-cancellation-reconciliation';
  private queue?: Queue<
    CancellationReconciliationJob,
    { processed: number },
    CancellationReconciliationJobName
  >;
  private worker?: Worker<
    CancellationReconciliationJob,
    { processed: number },
    CancellationReconciliationJobName
  >;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly cancellations: CancellationsService,
  ) {
    this.redisUrl = configService.getOrThrow('redis').url;
    this.intervalMilliseconds =
      configService.getOrThrow('cancellation').reconciliationIntervalMilliseconds;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
    });
    this.worker = new Worker(this.queueName, () => this.cancellations.reconcileDue(), {
      connection: { url: this.redisUrl, maxRetriesPerRequest: null },
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'cancellation_reconciliation_job_failed',
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'cancellation_reconciliation_worker_error', error: error.name }),
      );
    });
    await this.queue.add(
      'RECONCILE_CANCELLATIONS',
      {},
      {
        jobId: 'scheduled-cancellation-reconciliation',
        repeat: { every: this.intervalMilliseconds },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    );
    await this.queue.add(
      'RECONCILE_CANCELLATIONS',
      {},
      {
        jobId: `cancellation-reconciliation-startup-${process.pid}`,
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
