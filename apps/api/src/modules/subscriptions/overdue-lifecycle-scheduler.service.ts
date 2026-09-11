import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';

import type { AppConfig } from '../../config/configuration';
import { ProvisioningService } from './provisioning.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

type OverdueJob = Record<string, never>;
type OverdueResult = {
  invoicesMarkedOverdue: number;
  notificationsSent: number;
  subscriptionsSuspended: number;
  terminationReviewsQueued: number;
  provisioningRequestsProcessed: number;
};

@Injectable()
export class OverdueLifecycleSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueLifecycleSchedulerService.name);
  private readonly redisUrl: string;
  private readonly intervalMilliseconds: number;
  private readonly batchSize: number;
  private readonly queueName = 'mero-telecom-overdue-lifecycle';
  private queue?: Queue<OverdueJob, OverdueResult, 'RECONCILE_OVERDUE_LIFECYCLE'>;
  private worker?: Worker<OverdueJob, OverdueResult, 'RECONCILE_OVERDUE_LIFECYCLE'>;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly provisioning: ProvisioningService,
  ) {
    const settings = config.getOrThrow('overdueLifecycle');
    this.redisUrl = config.getOrThrow('redis').url;
    this.intervalMilliseconds = settings.schedulerIntervalMilliseconds;
    this.batchSize = settings.batchSize;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
    });
    this.worker = new Worker(this.queueName, () => this.reconcile(), {
      connection: { url: this.redisUrl, maxRetriesPerRequest: null },
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        JSON.stringify({
          event: 'overdue_lifecycle_job_failed',
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error.name,
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(
        JSON.stringify({ event: 'overdue_lifecycle_worker_error', error: error.name }),
      );
    });
    await this.queue.add(
      'RECONCILE_OVERDUE_LIFECYCLE',
      {},
      {
        jobId: 'scheduled-overdue-lifecycle',
        repeat: { every: this.intervalMilliseconds },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 500 },
      },
    );
    await this.queue.add(
      'RECONCILE_OVERDUE_LIFECYCLE',
      {},
      {
        jobId: `overdue-lifecycle-startup-${process.pid}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async reconcile(): Promise<OverdueResult> {
    const now = new Date();
    const invoicesMarkedOverdue = await this.lifecycle.markDueInvoicesOverdue(now);
    const notificationsSent = await this.lifecycle.processNotifications(now);
    const subscriptionsSuspended = await this.lifecycle.suspendExpiredGracePeriods(now);
    const terminationReviewsQueued = await this.lifecycle.queueTerminationReviews(now);
    const provisioningRequestsProcessed = await this.provisioning.reconcilePending(this.batchSize);
    return {
      invoicesMarkedOverdue,
      notificationsSent,
      subscriptionsSuspended,
      terminationReviewsQueued,
      provisioningRequestsProcessed,
    };
  }
}
