import { CancellationReconciliationSchedulerService } from './cancellation-reconciliation-scheduler.service';

const queueAdd = jest.fn();
const queueClose = jest.fn();
const workerClose = jest.fn();
const workerOn = jest.fn();
let processor: () => Promise<{ processed: number }>;

jest.mock('bullmq', () => ({
  Queue: class {
    add = queueAdd;
    close = queueClose;
  },
  Worker: class {
    constructor(_name: string, jobProcessor: () => Promise<{ processed: number }>) {
      processor = jobProcessor;
    }

    on = workerOn;
    close = workerClose;
  },
}));

describe('CancellationReconciliationSchedulerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue({});
    queueClose.mockResolvedValue(undefined);
    workerClose.mockResolvedValue(undefined);
  });

  it('registers recurring and startup reconciliation with retries', async () => {
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'redis'
          ? { url: 'redis://localhost:6380' }
          : { reconciliationIntervalMilliseconds: 45_000 },
      ),
    };
    const cancellations = { reconcileDue: jest.fn().mockResolvedValue({ processed: 2 }) };
    const service = new CancellationReconciliationSchedulerService(
      config as never,
      cancellations as never,
    );

    await service.onModuleInit();

    expect(queueAdd).toHaveBeenNthCalledWith(
      1,
      'RECONCILE_CANCELLATIONS',
      {},
      expect.objectContaining({
        jobId: 'scheduled-cancellation-reconciliation',
        repeat: { every: 45_000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
      }),
    );
    expect(queueAdd).toHaveBeenCalledTimes(2);
    await expect(processor()).resolves.toEqual({ processed: 2 });

    await service.onModuleDestroy();
    expect(workerClose).toHaveBeenCalledTimes(1);
    expect(queueClose).toHaveBeenCalledTimes(1);
  });
});
