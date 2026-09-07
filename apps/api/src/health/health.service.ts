import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundStatus } from '@prisma/client';

import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../modules/cache/redis.service';

export type DependencyStatus = 'ok' | 'error';

export interface DependencyChecks {
  database: DependencyStatus;
  redis: DependencyStatus;
}

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

export interface RefundHealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  staleProcessingRefunds: number;
  oldestProcessingAt: string | null;
}

const dependencyCheckTimeoutMilliseconds = 1_500;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getRefundsHealth(): Promise<RefundHealthResponse> {
    const staleAfter = this.config.getOrThrow('refundReconciliation').staleAfterMilliseconds;
    const cutoff = new Date(Date.now() - staleAfter);
    const [staleProcessingRefunds, oldest] = await Promise.all([
      this.prisma.refund.count({
        where: { status: RefundStatus.PROCESSING, updatedAt: { lt: cutoff } },
      }),
      this.prisma.refund.findFirst({
        where: { status: RefundStatus.PROCESSING },
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true },
      }),
    ]);
    return {
      status: staleProcessingRefunds > 0 ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      staleProcessingRefunds,
      oldestProcessingAt: oldest?.updatedAt.toISOString() ?? null,
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = await this.getDependencyChecks();
    const databaseReady = checks.database === 'ok';
    const redisReady = checks.redis === 'ok';

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

  async getDependencyChecks(): Promise<DependencyChecks> {
    const [databaseReady, redisReady] = await Promise.all([
      this.withTimeout(this.checkDatabase()),
      this.withTimeout(this.redis.ping()),
    ]);
    return {
      database: databaseReady ? 'ok' : 'error',
      redis: redisReady ? 'ok' : 'error',
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
