import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import { RedisService } from './redis.service';

export const ADMIN_DASHBOARD_CACHE_KEY = 'mero-telecom:dashboard:admin:v1';

@Injectable()
export class AdminDashboardCacheService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = configService.getOrThrow('cache').adminDashboardTtlSeconds;
  }

  async get<T>(): Promise<T | null> {
    const cached = await this.redis.get(ADMIN_DASHBOARD_CACHE_KEY);
    if (cached === null) return null;
    try {
      return JSON.parse(cached) as T;
    } catch {
      await this.redis.delete(ADMIN_DASHBOARD_CACHE_KEY);
      return null;
    }
  }

  set<T>(value: T): Promise<boolean> {
    return this.redis.setWithExpiry(
      ADMIN_DASHBOARD_CACHE_KEY,
      JSON.stringify(value),
      this.ttlSeconds,
    );
  }

  invalidate(): Promise<boolean> {
    return this.redis.delete(ADMIN_DASHBOARD_CACHE_KEY);
  }

  ttl(): Promise<number | null> {
    return this.redis.ttl(ADMIN_DASHBOARD_CACHE_KEY);
  }
}
