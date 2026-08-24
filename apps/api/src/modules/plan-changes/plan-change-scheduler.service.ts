import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import type { AppConfig } from '../../config/configuration';
import { PlanChangesService } from './plan-changes.service';

type PlanChangeReconciliationJob = Record<string, never>;
type PlanChangeReconciliationName = 'RECONCILE_SCHEDULED_DOWNGRADES';

@Injectable()
export class PlanChangeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlanChangeSchedulerService.name);
  private readonly redisUrl: string;
  private readonly queueName = 'mero-telecom-plan-change-reconciliation';
  private queue?: Queue<PlanChangeReconciliationJob, number, PlanChangeReconciliationName>;
  private worker?: Worker<PlanChangeReconciliationJob, number, PlanChangeReconciliationName>;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly planChanges: PlanChangesService,
  ) {
    this.redisUrl = configService.getOrThrow('redis').url;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<PlanChangeReconciliationJob, number, PlanChangeReconciliationName>(
      this.queueName,
      { connection: { url: this.redisUrl, maxRetriesPerRequest: 1 } },
    );
    this.worker = new Worker<PlanChangeReconciliationJob, number, PlanChangeReconciliationName>(
      this.queueName,
      () => this.planChanges.reconcileDueDowngrades(),
      {
        connection: { url: this.redisUrl, maxRetriesPerRequest: null },
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'plan_change_reconciliation_job_failed',
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'plan_change_reconciliation_worker_error', error: error.name }),
      );
    });
    await this.queue.add(
      'RECONCILE_SCHEDULED_DOWNGRADES',
      {},
      {
        jobId: 'scheduled-downgrade-reconciliation',
        repeat: { every: 60_000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    );
    await this.queue.add(
      'RECONCILE_SCHEDULED_DOWNGRADES',
      {},
      {
        jobId: `scheduled-downgrade-startup-${process.pid}`,
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
