import type { AppConfig } from '../../config/configuration';
import {
  AdminDashboardCacheService,
  ADMIN_DASHBOARD_CACHE_KEY,
} from './admin-dashboard-cache.service';
import type { RedisService } from './redis.service';

function createService(cached: string | null = null) {
  const redis = {
    get: jest.fn().mockResolvedValue(cached),
    setWithExpiry: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true),
    ttl: jest.fn().mockResolvedValue(42),
  };
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'cache') return { adminDashboardTtlSeconds: 60 };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  return {
    service: new AdminDashboardCacheService(
      redis as unknown as RedisService,
      configService as never,
    ),
    redis,
  };
}

describe('AdminDashboardCacheService', () => {
  it('stores JSON using the configured expiry', async () => {
    const { service, redis } = createService();
    const summary = { metrics: { customerCount: 2 } };

    await expect(service.set(summary)).resolves.toBe(true);
    expect(redis.setWithExpiry).toHaveBeenCalledWith(
      ADMIN_DASHBOARD_CACHE_KEY,
      JSON.stringify(summary),
      60,
    );
  });

  it('returns parsed cached data', async () => {
    const { service } = createService('{"metrics":{"customerCount":2}}');
    await expect(service.get()).resolves.toEqual({ metrics: { customerCount: 2 } });
  });

  it('deletes malformed cached data and treats it as a miss', async () => {
    const { service, redis } = createService('{not-json');
    await expect(service.get()).resolves.toBeNull();
    expect(redis.delete).toHaveBeenCalledWith(ADMIN_DASHBOARD_CACHE_KEY);
  });

  it('reports the remaining Redis TTL', async () => {
    const { service } = createService();
    await expect(service.ttl()).resolves.toBe(42);
  });
});
