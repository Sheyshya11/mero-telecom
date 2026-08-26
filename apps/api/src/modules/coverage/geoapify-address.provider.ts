import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import type { AddressLookupProvider, NormalizedAddressSuggestion } from './coverage.types';

type GeoapifyResult = Record<string, unknown>;

@Injectable()
export class GeoapifyAddressProvider implements AddressLookupProvider {
  private readonly logger = new Logger(GeoapifyAddressProvider.name);
  private readonly apiKey: string;
  private readonly timeoutMilliseconds: number;

  constructor(configService: ConfigService<AppConfig, true>) {
    const config = configService.getOrThrow('addressLookup');
    this.apiKey = config.geoapifyApiKey;
    this.timeoutMilliseconds = config.requestTimeoutMilliseconds;
  }

  async search(query: string): Promise<NormalizedAddressSuggestion[]> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Address suggestions are not configured. Please try again later.',
      );
    }

    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    url.search = new URLSearchParams({
      text: query,
      filter: 'countrycode:au',
      format: 'json',
      limit: '5',
      apiKey: this.apiKey,
    }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`GeoapifyHttp${response.status}`);
      return normalizeGeoapifyResponse(await response.json());
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'address_provider_unavailable',
          provider: 'geoapify',
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      throw new ServiceUnavailableException(
        'Address suggestions are temporarily unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeGeoapifyResponse(payload: unknown): NormalizedAddressSuggestion[] {
  if (typeof payload !== 'object' || payload === null || !('results' in payload)) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results
    .flatMap((result) => {
      const normalized = normalizeGeoapifyResult(result);
      return normalized ? [normalized] : [];
    })
    .slice(0, 5);
}

function normalizeGeoapifyResult(value: unknown): NormalizedAddressSuggestion | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result = value as GeoapifyResult;
  const formattedAddress = stringValue(result.formatted);
  const providerAddressId = stringValue(result.place_id);
  const countryCode = stringValue(result.country_code)?.toLowerCase() ?? null;
  const latitude = numberValue(result.lat);
  const longitude = numberValue(result.lon);
  const state = stringValue(result.state);
  const stateCode = stringValue(result.state_code)?.toUpperCase() ?? null;
  const postcode = stringValue(result.postcode);
  const street = stringValue(result.street);
  const suburb = stringValue(result.suburb) ?? stringValue(result.district);
  const city = stringValue(result.city) ?? stringValue(result.county);

  if (
    !formattedAddress ||
    !providerAddressId ||
    countryCode !== 'au' ||
    latitude === null ||
    longitude === null ||
    (!stateCode && !state) ||
    !postcode ||
    (!street && !suburb && !city)
  ) {
    return null;
  }

  return {
    provider: 'geoapify',
    providerAddressId,
    formattedAddress,
    unit: stringValue(result.unit),
    houseNumber: stringValue(result.housenumber),
    street,
    suburb,
    city,
    state,
    stateCode,
    postcode,
    countryCode,
    latitude,
    longitude,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
