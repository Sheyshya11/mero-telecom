import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoverageResultStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../cache/redis.service';
import { AddressSelectionService } from './address-selection.service';
import type {
  CoverageCheckResult,
  CoverageQualificationProvider,
  NormalizedAddressSuggestion,
  TrustedCoverageQualification,
} from './coverage.types';
import { COVERAGE_QUALIFICATION_PROVIDER } from './coverage.types';

@Injectable()
export class CoverageService {
  private readonly logger = new Logger(CoverageService.name);
  private readonly minimumCharacters: number;
  private readonly qualificationTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly selections: AddressSelectionService,
    private readonly redis: RedisService,
    @Inject(COVERAGE_QUALIFICATION_PROVIDER)
    private readonly qualificationProvider: CoverageQualificationProvider,
    configService: ConfigService<AppConfig, true>,
  ) {
    const addressLookup = configService.getOrThrow('addressLookup');
    this.minimumCharacters = addressLookup.minimumCharacters;
    this.qualificationTtlSeconds = addressLookup.selectionTtlSeconds;
  }

  async addressSuggestions(query: string) {
    if (query.trim().length < this.minimumCharacters) {
      throw new BadRequestException(
        `Address queries must contain at least ${this.minimumCharacters} characters.`,
      );
    }
    return { suggestions: await this.selections.suggestions(query) };
  }

  async check(selectionToken: string): Promise<CoverageCheckResult> {
    const address = await this.selections.consume(selectionToken);
    const decision = await this.qualificationProvider.qualify(address);
    await this.recordAnalytics(decision, address);
    const qualificationToken = decision.available
      ? await this.issueQualificationToken(address, decision)
      : null;
    return {
      available: decision.available,
      status: decision.status,
      message: decision.message,
      address: decision.address,
      qualification: decision.qualification,
      plans: decision.plans,
      qualificationToken,
    };
  }

  async consumeQualificationForPlan(
    qualificationToken: string,
    planId: string,
  ): Promise<TrustedCoverageQualification> {
    const selected = await this.redis.getAndDelete(this.qualificationKey(qualificationToken));
    if (!selected.available) {
      throw new ServiceUnavailableException(
        'Coverage verification is temporarily unavailable. Please check the address again later.',
      );
    }
    if (!selected.value) {
      throw new GoneException('This coverage result has expired or was already used.');
    }

    const qualification = this.parseQualification(selected.value);
    if (!qualification || new Date(qualification.expiresAt).getTime() <= Date.now()) {
      throw new GoneException('This coverage result has expired or is no longer valid.');
    }
    if (!qualification.compatiblePlanIds.includes(planId)) {
      throw new BadRequestException(
        'The selected plan is not compatible with this service address.',
      );
    }
    return qualification;
  }

  async assertTrustedAddressCanOrderPlan(
    address: NormalizedAddressSuggestion,
    planId: string,
  ): Promise<void> {
    const decision = await this.qualificationProvider.qualify(address);
    if (
      decision.status !== CoverageResultStatus.AVAILABLE ||
      !decision.plans.some((plan) => plan.id === planId)
    ) {
      throw new BadRequestException(
        'Mero Telecom service or the selected plan is no longer orderable at this address.',
      );
    }
  }

  private async issueQualificationToken(
    address: NormalizedAddressSuggestion,
    decision: Awaited<ReturnType<CoverageQualificationProvider['qualify']>>,
  ): Promise<string> {
    if (
      !decision.qualification.technology ||
      !decision.qualification.maximumSpeedMbps ||
      !decision.plans.length
    ) {
      throw new ServiceUnavailableException(
        'This coverage result cannot currently be prepared for checkout.',
      );
    }
    const qualificationToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.qualificationTtlSeconds * 1_000).toISOString();
    const qualification: TrustedCoverageQualification = {
      address,
      compatiblePlanIds: decision.plans.map((plan) => plan.id),
      technology: decision.qualification.technology,
      maximumSpeedMbps: decision.qualification.maximumSpeedMbps,
      checkedAt: decision.qualification.checkedAt,
      expiresAt,
    };
    const stored = await this.redis.setWithExpiry(
      this.qualificationKey(qualificationToken),
      JSON.stringify(qualification),
      this.qualificationTtlSeconds,
    );
    if (!stored) {
      throw new ServiceUnavailableException(
        'Coverage verification is temporarily unavailable. Please try again later.',
      );
    }
    return qualificationToken;
  }

  private qualificationKey(token: string): string {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return `mero-telecom:coverage:qualification:v1:${tokenHash}`;
  }

  private parseQualification(value: string): TrustedCoverageQualification | null {
    try {
      const parsed = JSON.parse(value) as Partial<TrustedCoverageQualification>;
      if (
        typeof parsed !== 'object' ||
        !parsed.address ||
        !Array.isArray(parsed.compatiblePlanIds) ||
        !parsed.compatiblePlanIds.every((planId) => typeof planId === 'string') ||
        typeof parsed.technology !== 'string' ||
        typeof parsed.maximumSpeedMbps !== 'number' ||
        typeof parsed.checkedAt !== 'string' ||
        typeof parsed.expiresAt !== 'string'
      ) {
        return null;
      }
      return parsed as TrustedCoverageQualification;
    } catch {
      return null;
    }
  }

  private async recordAnalytics(
    decision: Awaited<ReturnType<CoverageQualificationProvider['qualify']>>,
    address: NormalizedAddressSuggestion,
  ): Promise<void> {
    try {
      await this.prisma.coverageSearch.create({
        data: {
          resultStatus: decision.status,
          stateCode: decision.address.stateCode,
          postcode: decision.address.postcode,
          technology: decision.qualification.technology,
          plansReturned: decision.plans.length > 0,
          operatingRegionId: decision.operatingRegionId,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'coverage_analytics_write_failed',
          provider: address.provider,
          resultStatus: decision.status,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
