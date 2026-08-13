import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

import type { AppConfig } from '../../config/configuration';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: ReturnType<typeof createClient>;
  private unavailableWarningLogged = false;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.client = createClient({
      url: configService.getOrThrow('redis').url,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: (attempts) =>
          attempts >= 3
            ? new Error('Redis reconnect limit reached.')
            : Math.min(100 * 2 ** attempts, 1_000),
      },
    });
    this.client.on('error', () => this.warnUnavailable());
    this.client.on('ready', () => {
      this.unavailableWarningLogged = false;
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      this.warnUnavailable();
      if (this.client.isOpen) this.client.destroy();
    }
  }

  onModuleDestroy(): void {
    if (this.client.isOpen) this.client.destroy();
  }

  async get(key: string): Promise<string | null> {
    if (!this.client.isReady) return null;
    try {
      return await this.client.get(key);
    } catch {
      this.warnUnavailable();
      return null;
    }
  }

  async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client.isReady) return false;
    try {
      await this.client.set(key, value, { EX: ttlSeconds });
      return true;
    } catch {
      this.warnUnavailable();
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.client.isReady) return false;
    try {
      await this.client.del(key);
      return true;
    } catch {
      this.warnUnavailable();
      return false;
    }
  }

  async ttl(key: string): Promise<number | null> {
    if (!this.client.isReady) return null;
    try {
      return await this.client.ttl(key);
    } catch {
      this.warnUnavailable();
      return null;
    }
  }

  private warnUnavailable(): void {
    if (this.unavailableWarningLogged) return;
    this.unavailableWarningLogged = true;
    this.logger.warn('Redis is unavailable; requests will use the database until it recovers.');
  }
}
