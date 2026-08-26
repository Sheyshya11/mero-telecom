import { GoneException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';
import { createHash, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config/configuration';
import { RedisService } from '../cache/redis.service';
import { CoverageService } from '../coverage/coverage.service';
import type {
  NormalizedAddressSuggestion,
  TrustedCoverageQualification,
} from '../coverage/coverage.types';

export interface TrustedPublicCheckoutContext {
  version: 1;
  planId: string;
  trustedServiceAddress: NormalizedAddressSuggestion;
  technology: TrustedCoverageQualification['technology'];
  maximumSpeedMbps: number;
  checkedAt: string;
  expiresAt: string;
}

export interface PublicCheckoutContextView {
  planId: string;
  serviceAddress: {
    formattedAddress: string;
    suburb: string | null;
    stateCode: string | null;
    postcode: string | null;
  };
  qualification: {
    technology: TrustedCoverageQualification['technology'];
    maximumSpeedMbps: number;
    source: 'DATABASE_ESTIMATE';
    checkedAt: string;
  };
  expiresAt: string;
}

@Injectable()
export class PublicCheckoutContextService {
  readonly cookieName = 'mero_public_checkout_context';
  private readonly ttlSeconds: number;
  private readonly isProduction: boolean;

  constructor(
    private readonly redis: RedisService,
    private readonly coverage: CoverageService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.ttlSeconds = configService.getOrThrow('publicCheckout').contextTtlSeconds;
    this.isProduction = configService.getOrThrow('app').environment === 'production';
  }

  async prepare(
    planId: string,
    qualificationToken: string,
  ): Promise<{ contextToken: string; context: PublicCheckoutContextView }> {
    const qualification = await this.coverage.consumeQualificationForPlan(
      qualificationToken,
      planId,
    );
    const contextToken = randomBytes(32).toString('base64url');
    const record: TrustedPublicCheckoutContext = {
      version: 1,
      planId,
      trustedServiceAddress: qualification.address,
      technology: qualification.technology,
      maximumSpeedMbps: qualification.maximumSpeedMbps,
      checkedAt: qualification.checkedAt,
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1_000).toISOString(),
    };
    const stored = await this.redis.setWithExpiry(
      this.key(contextToken),
      JSON.stringify(record),
      this.ttlSeconds,
    );
    if (!stored) {
      throw new ServiceUnavailableException(
        'Checkout preparation is temporarily unavailable. Please try again later.',
      );
    }
    return { contextToken, context: this.view(record) };
  }

  async get(contextToken: string | undefined): Promise<PublicCheckoutContextView> {
    const record = await this.load(contextToken, false);
    return this.view(record);
  }

  consume(
    contextToken: string | undefined,
    expectedPlanId: string,
  ): Promise<TrustedPublicCheckoutContext> {
    return this.load(contextToken, true, expectedPlanId);
  }

  async clear(contextToken: string | undefined): Promise<void> {
    if (!contextToken || !this.validToken(contextToken)) return;
    await this.redis.delete(this.key(contextToken));
  }

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.isProduction ? 'none' : 'lax',
      path: '/api/v1/payments',
      maxAge: this.ttlSeconds * 1_000,
    };
  }

  clearCookieOptions(): CookieOptions {
    const options = this.cookieOptions();
    delete options.maxAge;
    return options;
  }

  private async load(
    contextToken: string | undefined,
    consume: boolean,
    expectedPlanId?: string,
  ): Promise<TrustedPublicCheckoutContext> {
    if (!contextToken || !this.validToken(contextToken)) {
      throw new GoneException('Check service availability before continuing to checkout.');
    }
    const selected = consume
      ? await this.redis.getAndDelete(this.key(contextToken))
      : await this.redis.getWithAvailability(this.key(contextToken));
    if (!selected.available) {
      throw new ServiceUnavailableException(
        'Checkout verification is temporarily unavailable. Please try again later.',
      );
    }
    if (!selected.value) {
      throw new GoneException('Your checkout coverage confirmation has expired.');
    }
    const record = this.parse(selected.value);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new GoneException('Your checkout coverage confirmation has expired.');
    }
    if (expectedPlanId && record.planId !== expectedPlanId) {
      throw new GoneException('Coverage must be confirmed again for the selected plan.');
    }
    return record;
  }

  private view(record: TrustedPublicCheckoutContext): PublicCheckoutContextView {
    return {
      planId: record.planId,
      serviceAddress: {
        formattedAddress: record.trustedServiceAddress.formattedAddress,
        suburb: record.trustedServiceAddress.suburb ?? record.trustedServiceAddress.city,
        stateCode: record.trustedServiceAddress.stateCode,
        postcode: record.trustedServiceAddress.postcode,
      },
      qualification: {
        technology: record.technology,
        maximumSpeedMbps: record.maximumSpeedMbps,
        source: 'DATABASE_ESTIMATE',
        checkedAt: record.checkedAt,
      },
      expiresAt: record.expiresAt,
    };
  }

  private parse(value: string): TrustedPublicCheckoutContext | null {
    try {
      const parsed = JSON.parse(value) as Partial<TrustedPublicCheckoutContext>;
      if (
        parsed.version !== 1 ||
        typeof parsed.planId !== 'string' ||
        !parsed.trustedServiceAddress ||
        typeof parsed.technology !== 'string' ||
        typeof parsed.maximumSpeedMbps !== 'number' ||
        typeof parsed.checkedAt !== 'string' ||
        typeof parsed.expiresAt !== 'string'
      ) {
        return null;
      }
      return parsed as TrustedPublicCheckoutContext;
    } catch {
      return null;
    }
  }

  private key(token: string): string {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return `mero-telecom:payments:public-checkout-context:v1:${tokenHash}`;
  }

  private validToken(token: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(token);
  }
}
