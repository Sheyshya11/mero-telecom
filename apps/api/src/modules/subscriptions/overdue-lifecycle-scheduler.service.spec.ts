import type { AppConfig } from '../../config/configuration';
import { OverdueLifecycleSchedulerService } from './overdue-lifecycle-scheduler.service';

describe('OverdueLifecycleSchedulerService', () => {
  it('reconciles overdue state idempotently through domain services without terminating service', async () => {
    const lifecycle = {
      markDueInvoicesOverdue: jest.fn().mockResolvedValue(2),
      processNotifications: jest.fn().mockResolvedValue(1),
      suspendExpiredGracePeriods: jest.fn().mockResolvedValue(1),
      queueTerminationReviews: jest.fn().mockResolvedValue(1),
      terminateForNonPayment: jest.fn(),
    };
    const provisioning = { reconcilePending: jest.fn().mockResolvedValue(1) };
    const config = {
      getOrThrow: jest.fn((key: keyof AppConfig) =>
        key === 'redis'
          ? { url: 'redis://localhost:6380' }
          : { schedulerIntervalMilliseconds: 60_000, batchSize: 50 },
      ),
    };
    const scheduler = new OverdueLifecycleSchedulerService(
      config as never,
      lifecycle as never,
      provisioning as never,
    );

    await expect(scheduler.reconcile()).resolves.toEqual({
      invoicesMarkedOverdue: 2,
      notificationsSent: 1,
      subscriptionsSuspended: 1,
      terminationReviewsQueued: 1,
      provisioningRequestsProcessed: 1,
    });
    expect(lifecycle.terminateForNonPayment).not.toHaveBeenCalled();
  });
});
