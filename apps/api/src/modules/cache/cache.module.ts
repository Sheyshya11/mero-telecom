import { Global, Module } from '@nestjs/common';

import { AdminDashboardCacheService } from './admin-dashboard-cache.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, AdminDashboardCacheService],
  exports: [RedisService, AdminDashboardCacheService],
})
export class CacheModule {}
