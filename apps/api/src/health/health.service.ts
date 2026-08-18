import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../modules/cache/redis.service';

type DependencyStatus = 'ok' | 'error';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse extends HealthResponse {
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

const dependencyCheckTimeoutMilliseconds = 1_500;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [databaseReady, redisReady] = await Promise.all([
      this.withTimeout(this.checkDatabase()),
      this.withTimeout(this.redis.ping()),
    ]);
    const checks: ReadinessResponse['checks'] = {
      database: databaseReady ? 'ok' : 'error',
      redis: redisReady ? 'ok' : 'error',
    };

    if (!databaseReady || !redisReady) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCIES_UNAVAILABLE',
        message: 'One or more required services are unavailable.',
        errors: { checks },
      });
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async withTimeout(operation: Promise<boolean>): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), dependencyCheckTimeoutMilliseconds);
    });

    const result = await Promise.race([operation, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
}
