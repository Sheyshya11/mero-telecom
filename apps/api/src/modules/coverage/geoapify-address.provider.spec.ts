import { ServiceUnavailableException } from '@nestjs/common';

import { GeoapifyAddressProvider, normalizeGeoapifyResponse } from './geoapify-address.provider';

const validResult = {
  formatted: '12 King William Street, Adelaide SA 5000, Australia',
  place_id: 'geoapify-place-id',
  unit: '4',
  housenumber: '12',
  street: 'King William Street',
  suburb: 'Adelaide',
  city: 'Adelaide',
  state: 'South Australia',
  state_code: 'sa',
  postcode: '5000',
  country_code: 'AU',
  lat: -34.925,
  lon: 138.599,
};

describe('Geoapify normalization', () => {
  it('normalizes a valid Australian result without exposing the raw payload', () => {
    expect(normalizeGeoapifyResponse({ results: [validResult] })).toEqual([
      {
        provider: 'geoapify',
        providerAddressId: 'geoapify-place-id',
        formattedAddress: validResult.formatted,
        unit: '4',
        houseNumber: '12',
        street: 'King William Street',
        suburb: 'Adelaide',
        city: 'Adelaide',
        state: 'South Australia',
        stateCode: 'SA',
        postcode: '5000',
        countryCode: 'au',
        latitude: -34.925,
        longitude: 138.599,
      },
    ]);
  });

  it('retains the full state name when Geoapify omits state_code', () => {
    const withoutCode: Record<string, unknown> = { ...validResult };
    delete withoutCode.state_code;
    expect(normalizeGeoapifyResponse({ results: [withoutCode] })[0]).toEqual(
      expect.objectContaining({ state: 'South Australia', stateCode: null }),
    );
  });

  it('rejects non-Australian, coordinate-free, and location-incomplete results', () => {
    expect(
      normalizeGeoapifyResponse({
        results: [
          { ...validResult, country_code: 'NZ' },
          { ...validResult, lat: undefined },
          { ...validResult, street: undefined, suburb: undefined, city: undefined },
        ],
      }),
    ).toEqual([]);
  });
});

describe('GeoapifyAddressProvider', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      geoapifyApiKey: 'server-only-key',
      requestTimeoutMilliseconds: 25,
    }),
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('uses the Australia filter and converts provider failures to safe 503 errors', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('provider internals')) as typeof fetch;
    const provider = new GeoapifyAddressProvider(config as never);

    await expect(provider.search('Adelaide')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const requestedUrl = (global.fetch as jest.Mock).mock.calls[0][0] as URL;
    expect(requestedUrl.searchParams.get('filter')).toBe('countrycode:au');
    expect(requestedUrl.searchParams.get('limit')).toBe('5');
    expect(requestedUrl.searchParams.get('apiKey')).toBe('server-only-key');
  });

  it('aborts a provider request at the configured timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;
    const provider = new GeoapifyAddressProvider(config as never);

    const result = expect(provider.search('Adelaide')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(25);
    await result;
  });
});
