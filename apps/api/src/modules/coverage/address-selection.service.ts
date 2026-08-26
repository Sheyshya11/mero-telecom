import { GoneException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config/configuration';
import { RedisService } from '../cache/redis.service';
import type {
  AddressLookupProvider,
  NormalizedAddressSuggestion,
  PublicAddressSuggestion,
} from './coverage.types';
import { ADDRESS_LOOKUP_PROVIDER } from './coverage.types';
import { Inject } from '@nestjs/common';

@Injectable()
export class AddressSelectionService {
  private readonly cacheTtlSeconds: number;
  private readonly selectionTtlSeconds: number;

  constructor(
    @Inject(ADDRESS_LOOKUP_PROVIDER)
    private readonly provider: AddressLookupProvider,
    private readonly redis: RedisService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const config = configService.getOrThrow('addressLookup');
    this.cacheTtlSeconds = config.cacheTtlSeconds;
    this.selectionTtlSeconds = config.selectionTtlSeconds;
  }

  async suggestions(query: string): Promise<PublicAddressSuggestion[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
    const cacheKey = `mero-telecom:coverage:query:v1:${this.hash(normalizedQuery)}`;
    const cached = await this.redis.get(cacheKey);
    let suggestions = cached ? this.parseSuggestions(cached) : null;
    if (!suggestions) {
      suggestions = await this.provider.search(query.trim());
      await this.redis.setWithExpiry(cacheKey, JSON.stringify(suggestions), this.cacheTtlSeconds);
    }

    return Promise.all(suggestions.slice(0, 5).map((suggestion) => this.trust(suggestion)));
  }

  async consume(selectionToken: string): Promise<NormalizedAddressSuggestion> {
    const key = this.selectionKey(selectionToken);
    const selected = await this.redis.getAndDelete(key);
    if (!selected.available) {
      throw new ServiceUnavailableException(
        'Address selection verification is temporarily unavailable. Please select the address again later.',
      );
    }
    if (!selected.value) {
      throw new GoneException('This address selection has expired or was already used.');
    }
    try {
      return JSON.parse(selected.value) as NormalizedAddressSuggestion;
    } catch {
      throw new GoneException('This address selection is no longer valid.');
    }
  }

  private async trust(suggestion: NormalizedAddressSuggestion): Promise<PublicAddressSuggestion> {
    const selectionToken = randomBytes(32).toString('base64url');
    const stored = await this.redis.setWithExpiry(
      this.selectionKey(selectionToken),
      JSON.stringify(suggestion),
      this.selectionTtlSeconds,
    );
    if (!stored) {
      throw new ServiceUnavailableException(
        'Address selection verification is temporarily unavailable. Please try again later.',
      );
    }
    return {
      selectionToken,
      formattedAddress: suggestion.formattedAddress,
      suburb: suggestion.suburb,
      state: suggestion.state,
      stateCode: suggestion.stateCode,
      postcode: suggestion.postcode,
    };
  }

  private selectionKey(token: string): string {
    return `mero-telecom:coverage:selection:v1:${this.hash(token)}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private parseSuggestions(value: string): NormalizedAddressSuggestion[] | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as NormalizedAddressSuggestion[]) : null;
    } catch {
      return null;
    }
  }
}
