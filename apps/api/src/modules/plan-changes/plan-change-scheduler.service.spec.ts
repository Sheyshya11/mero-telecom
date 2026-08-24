import { PlanChangeSchedulerService } from './plan-change-scheduler.service';

const queueAdd = jest.fn();
const queueClose = jest.fn();
const workerClose = jest.fn();
const workerOn = jest.fn();
let processor: () => Promise<number>;

jest.mock('bullmq', () => ({
  Queue: class {
    add = queueAdd;
    close = queueClose;
  },
  Worker: class {
    constructor(_name: string, jobProcessor: () => Promise<number>) {
      processor = jobProcessor;
    }

    on = workerOn;
    close = workerClose;
  },
}));

describe('PlanChangeSchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue({});
    queueClose.mockResolvedValue(undefined);
    workerClose.mockResolvedValue(undefined);
  });

  it('registers recurring and startup reconciliation with retries', async () => {
    const planChanges = { reconcileDueDowngrades: jest.fn().mockResolvedValue(2) };
    const service = new PlanChangeSchedulerService(
      { getOrThrow: jest.fn().mockReturnValue({ url: 'redis://localhost:6380' }) } as never,
      planChanges as never,
    );

    await service.onModuleInit();

    expect(queueAdd).toHaveBeenNthCalledWith(
      1,
      'RECONCILE_SCHEDULED_DOWNGRADES',
      {},
      expect.objectContaining({
        jobId: 'scheduled-downgrade-reconciliation',
        repeat: { every: 60_000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
      }),
    );
    expect(queueAdd).toHaveBeenCalledTimes(2);
    await expect(processor()).resolves.toBe(2);
    expect(planChanges.reconcileDueDowngrades).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(workerClose).toHaveBeenCalledTimes(1);
    expect(queueClose).toHaveBeenCalledTimes(1);
  });
});
