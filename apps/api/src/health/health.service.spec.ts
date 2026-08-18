import { ServiceUnavailableException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service';
import type { RedisService } from '../modules/cache/redis.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const queryRawUnsafe = jest.fn();
  const ping = jest.fn();
  const service = new HealthService(
    { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService,
    { ping } as unknown as RedisService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an operational status with a timestamp', () => {
    expect(service.getHealth()).toMatchObject({ status: 'ok' });
  });

  it('reports ready when PostgreSQL and Redis respond', async () => {
    queryRawUnsafe.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue(true);

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
  });

  it('reports unavailable when a required dependency fails', async () => {
    queryRawUnsafe.mockRejectedValue(new Error('database unavailable'));
    ping.mockResolvedValue(true);

    await expect(service.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
