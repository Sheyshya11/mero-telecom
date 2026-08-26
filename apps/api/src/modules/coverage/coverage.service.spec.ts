import { BadRequestException, GoneException, ServiceUnavailableException } from '@nestjs/common';
import { CoverageResultStatus } from '@prisma/client';

import { AddressSelectionService } from './address-selection.service';
import { CoverageService } from './coverage.service';
import type { CoverageQualificationProvider, NormalizedAddressSuggestion } from './coverage.types';

const address: NormalizedAddressSuggestion = {
  provider: 'geoapify',
  providerAddressId: 'address-id',
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

describe('AddressSelectionService', () => {
  const provider = { search: jest.fn().mockResolvedValue([address]) };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ cacheTtlSeconds: 600, selectionTtlSeconds: 900 }),
  };

  it('returns display-safe suggestions and stores the trusted provider result', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      setWithExpiry: jest.fn().mockResolvedValue(true),
      getAndDelete: jest.fn(),
    };
    const service = new AddressSelectionService(provider, redis as never, config as never);

    const result = await service.suggestions('1 North Terrace');

    expect(result).toEqual([
      expect.objectContaining({
        formattedAddress: address.formattedAddress,
        stateCode: 'SA',
        selectionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    ]);
    expect(result[0]).not.toHaveProperty('latitude');
    expect(result[0]).not.toHaveProperty('providerAddressId');
    expect(redis.setWithExpiry).toHaveBeenCalledTimes(2);
  });

  it('rejects an expired or already-consumed selection token', async () => {
    const redis = {
      getAndDelete: jest.fn().mockResolvedValue({ available: true, value: null }),
    };
    const service = new AddressSelectionService(provider, redis as never, config as never);
    await expect(service.consume('a'.repeat(43))).rejects.toBeInstanceOf(GoneException);
  });

  it('fails closed when Redis cannot verify a selection', async () => {
    const redis = {
      getAndDelete: jest.fn().mockResolvedValue({ available: false, value: null }),
    };
    const service = new AddressSelectionService(provider, redis as never, config as never);
    await expect(service.consume('a'.repeat(43))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('CoverageService', () => {
  const selections = {
    suggestions: jest.fn().mockResolvedValue([]),
    consume: jest.fn().mockResolvedValue(address),
  };
  const availableDecision = {
    available: true,
    status: CoverageResultStatus.AVAILABLE,
    message: 'Estimated available.',
    address: {
      formattedAddress: address.formattedAddress,
      suburb: 'Adelaide',
      stateCode: 'SA',
      postcode: '5000',
    },
    qualification: {
      technology: 'FTTP' as const,
      maximumSpeedMbps: 1000,
      source: 'DATABASE_ESTIMATE' as const,
      checkedAt: new Date().toISOString(),
    },
    plans: [
      {
        id: 'plan-id',
        name: 'Essential 50',
        description: null,
        downloadMbps: 50,
        uploadMbps: 20,
        monthlyCents: 6900,
      },
    ],
    operatingRegionId: 'region-id',
  };
  const qualification = { qualify: jest.fn().mockResolvedValue(availableDecision) };
  const prisma = { coverageSearch: { create: jest.fn().mockResolvedValue({}) } };
  const redis = {
    setWithExpiry: jest.fn().mockResolvedValue(true),
    getAndDelete: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ minimumCharacters: 3, selectionTtlSeconds: 900 }),
  };
  const service = new CoverageService(
    prisma as never,
    selections as unknown as AddressSelectionService,
    redis as never,
    qualification as CoverageQualificationProvider,
    config as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('enforces the configured minimum query length', async () => {
    await expect(service.addressSuggestions('ab')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the trusted selection and omits internal region identifiers publicly', async () => {
    const result = await service.check('a'.repeat(43));
    expect(result.status).toBe(CoverageResultStatus.AVAILABLE);
    expect(result.qualificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result).not.toHaveProperty('operatingRegionId');
    expect(prisma.coverageSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stateCode: 'SA',
          postcode: '5000',
          plansReturned: true,
        }),
      }),
    );
  });

  it('issues and consumes a one-use qualification token bound to compatible plans', async () => {
    redis.getAndDelete.mockResolvedValue({
      available: true,
      value: JSON.stringify({
        address,
        compatiblePlanIds: ['plan-id'],
        technology: 'FTTP',
        maximumSpeedMbps: 1000,
        checkedAt: '2026-08-25T00:00:00.000Z',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    await expect(service.consumeQualificationForPlan('a'.repeat(43), 'plan-id')).resolves.toEqual(
      expect.objectContaining({ address, compatiblePlanIds: ['plan-id'] }),
    );
    await expect(
      service.assertTrustedAddressCanOrderPlan(address, 'plan-id'),
    ).resolves.toBeUndefined();
  });
});
