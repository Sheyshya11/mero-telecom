import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import type { AppConfig } from '../../config/configuration';
import { RelocationsService } from './relocations.service';

type RelocationJob = Record<string, never>;
type RelocationJobName = 'RECONCILE_RELOCATIONS';

@Injectable()
export class RelocationReconciliationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelocationReconciliationSchedulerService.name);
  private readonly redisUrl: string;
  private readonly intervalMilliseconds: number;
  private readonly batchSize: number;
  private readonly queueName = 'mero-telecom-relocation-reconciliation';
  private queue?: Queue<RelocationJob, { processed: number }, RelocationJobName>;
  private worker?: Worker<RelocationJob, { processed: number }, RelocationJobName>;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly relocations: RelocationsService,
  ) {
    this.redisUrl = config.getOrThrow('redis').url;
    const relocation = config.getOrThrow('relocation');
    this.intervalMilliseconds = relocation.reconciliationIntervalMilliseconds;
    this.batchSize = relocation.batchSize;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
    });
    this.worker = new Worker(
      this.queueName,
      async () => ({ processed: await this.relocations.reconcileDue(this.batchSize) }),
      { connection: { url: this.redisUrl, maxRetriesPerRequest: null }, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'relocation_reconciliation_job_failed',
          jobId: job?.id,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'relocation_reconciliation_worker_error', error: error.name }),
      );
    });
    await this.queue.add(
      'RECONCILE_RELOCATIONS',
      {},
      {
        jobId: 'scheduled-relocation-reconciliation',
        repeat: { every: this.intervalMilliseconds },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
