import { GoneException, ServiceUnavailableException } from '@nestjs/common';

import type { AppConfig } from '../../config/configuration';
import { PublicCheckoutContextService } from './public-checkout-context.service';

const trustedAddress = {
  provider: 'geoapify' as const,
  providerAddressId: 'trusted-address-id',
  formattedAddress: '1 North Terrace, Adelaide SA 5000, Australia',
  unit: null,
  houseNumber: '1',
  street: 'North Terrace',
  suburb: 'Adelaide',
  city: 'Adelaide',
  state: 'South Australia',
  stateCode: 'SA',
  postcode: '5000',
  countryCode: 'au',
  latitude: -34.92,
  longitude: 138.6,
};

function config(environment = 'test') {
  return {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'publicCheckout') return { contextTtlSeconds: 1800 };
      if (key === 'app') return { environment };
      throw new Error(`Unexpected config: ${key}`);
    }),
  };
}

describe('PublicCheckoutContextService', () => {
  it('stores only a server-side context and returns a display-safe view', async () => {
    const redis = {
      setWithExpiry: jest.fn().mockResolvedValue(true),
      getWithAvailability: jest.fn(),
      getAndDelete: jest.fn(),
      delete: jest.fn(),
    };
    const coverage = {
      consumeQualificationForPlan: jest.fn().mockResolvedValue({
        address: trustedAddress,
        compatiblePlanIds: ['plan-id'],
        technology: 'FTTP',
        maximumSpeedMbps: 1000,
        checkedAt: '2026-08-25T00:00:00.000Z',
        expiresAt: '2026-08-25T00:15:00.000Z',
      }),
    };
    const service = new PublicCheckoutContextService(
      redis as never,
      coverage as never,
      config() as never,
    );

    const prepared = await service.prepare('plan-id', 'q'.repeat(43));

    expect(prepared.contextToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prepared.context).toEqual(
      expect.objectContaining({
        planId: 'plan-id',
        serviceAddress: expect.objectContaining({
          formattedAddress: trustedAddress.formattedAddress,
        }),
        qualification: expect.objectContaining({ technology: 'FTTP' }),
      }),
    );
    expect(prepared.context).not.toHaveProperty('trustedServiceAddress');
    expect(redis.setWithExpiry).toHaveBeenCalledWith(
      expect.stringMatching(/^mero-telecom:payments:public-checkout-context:v1:/),
      expect.stringContaining('trusted-address-id'),
      1800,
    );
  });

  it('atomically consumes a context and rejects a different plan', async () => {
    const record = {
      version: 1,
      planId: 'plan-id',
      trustedServiceAddress: trustedAddress,
      technology: 'FTTP',
      maximumSpeedMbps: 1000,
      checkedAt: '2026-08-25T00:00:00.000Z',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const redis = {
      getAndDelete: jest.fn().mockResolvedValue({
        available: true,
        value: JSON.stringify(record),
      }),
    };
    const service = new PublicCheckoutContextService(
      redis as never,
      {} as never,
      config() as never,
    );

    await expect(service.consume('c'.repeat(43), 'other-plan')).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(redis.getAndDelete).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Redis cannot verify a checkout context', async () => {
    const redis = {
      getWithAvailability: jest.fn().mockResolvedValue({ available: false, value: null }),
    };
    const service = new PublicCheckoutContextService(
      redis as never,
      {} as never,
      config() as never,
    );

    await expect(service.get('c'.repeat(43))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
