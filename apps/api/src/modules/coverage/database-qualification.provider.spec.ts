import {
  AddressOverrideStatus,
  CoverageResultStatus,
  OperatingRegionStatus,
  PostcodeCoverageStatus,
} from '@prisma/client';

import { normalizeAustralianStateCode } from './australian-states';
import { DatabaseCoverageQualificationProvider } from './database-qualification.provider';
import type { NormalizedAddressSuggestion } from './coverage.types';

const address: NormalizedAddressSuggestion = {
  provider: 'geoapify',
  providerAddressId: 'selected-address-id',
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

const region = {
  id: 'region-id',
  countryCode: 'AU',
  stateCode: 'SA',
  name: 'South Australia',
  status: OperatingRegionStatus.ACTIVE,
};

const availablePostcode = {
  id: 'postcode-id',
  operatingRegionId: region.id,
  postcode: '5000',
  status: PostcodeCoverageStatus.AVAILABLE,
  technology: 'FTTP' as const,
  maximumSpeedMbps: 100,
  isActive: true,
};

function setup() {
  const prisma = {
    operatingRegion: { findUnique: jest.fn().mockResolvedValue(region) },
    addressCoverageOverride: { findUnique: jest.fn().mockResolvedValue(null) },
    postcodeCoverage: { findUnique: jest.fn().mockResolvedValue(availablePostcode) },
    internetPlan: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'essential-id',
          name: 'Essential 50',
          description: null,
          downloadMbps: 50,
          uploadMbps: 20,
          monthlyCents: 6900,
          coverageRules: [
            {
              operatingRegionId: region.id,
              postcode: null,
              minimumSpeedMbps: null,
              maximumSpeedMbps: null,
            },
          ],
        },
        {
          id: 'business-id',
          name: 'Business 250',
          description: null,
          downloadMbps: 250,
          uploadMbps: 25,
          monthlyCents: 10900,
          coverageRules: [
            {
              operatingRegionId: region.id,
              postcode: null,
              minimumSpeedMbps: null,
              maximumSpeedMbps: null,
            },
          ],
        },
      ]),
    },
  };
  return { prisma, provider: new DatabaseCoverageQualificationProvider(prisma as never) };
}

describe('Australian state normalization', () => {
  it.each([
    ['SA', null, 'SA'],
    [null, 'South Australia', 'SA'],
    ['sa', 'South Australia', 'SA'],
    [null, 'Victoria', 'VIC'],
  ])('normalizes %s / %s to %s', (code, name, expected) => {
    expect(normalizeAustralianStateCode(code, name)).toBe(expected);
  });
});

describe('DatabaseCoverageQualificationProvider', () => {
  it('requires an Australian country code before database qualification', async () => {
    const { prisma, provider } = setup();
    const result = await provider.qualify({ ...address, countryCode: 'nz' });
    expect(result.status).toBe(CoverageResultStatus.OUTSIDE_OPERATING_REGION);
    expect(prisma.operatingRegion.findUnique).not.toHaveBeenCalled();
  });

  it('matches South Australia by its full state name when state_code is absent', async () => {
    const { prisma, provider } = setup();
    await provider.qualify({ ...address, stateCode: null });
    expect(prisma.operatingRegion.findUnique).toHaveBeenCalledWith({
      where: { countryCode_stateCode: { countryCode: 'AU', stateCode: 'SA' } },
    });
  });

  it('returns coming soon for a configured coming-soon state', async () => {
    const { prisma, provider } = setup();
    prisma.operatingRegion.findUnique.mockResolvedValue({
      ...region,
      stateCode: 'VIC',
      status: OperatingRegionStatus.COMING_SOON,
    });
    const result = await provider.qualify({
      ...address,
      state: 'Victoria',
      stateCode: 'VIC',
      postcode: '3000',
    });
    expect(result.status).toBe(CoverageResultStatus.COMING_SOON);
  });

  it('returns outside region for an unsupported state', async () => {
    const { prisma, provider } = setup();
    prisma.operatingRegion.findUnique.mockResolvedValue(null);
    const result = await provider.qualify({
      ...address,
      state: 'Victoria',
      stateCode: 'VIC',
      postcode: '3000',
    });
    expect(result.status).toBe(CoverageResultStatus.OUTSIDE_OPERATING_REGION);
  });

  it('gives an exact-address override precedence over postcode coverage', async () => {
    const { prisma, provider } = setup();
    prisma.addressCoverageOverride.findUnique.mockResolvedValue({
      operatingRegionId: region.id,
      isActive: true,
      status: AddressOverrideStatus.UNAVAILABLE,
      technology: null,
      maximumSpeedMbps: null,
    });
    const result = await provider.qualify(address);
    expect(result.status).toBe(CoverageResultStatus.NOT_AVAILABLE);
    expect(prisma.postcodeCoverage.findUnique).not.toHaveBeenCalled();
  });

  it('performs an exact postcode lookup and never infers a numerical range', async () => {
    const { prisma, provider } = setup();
    prisma.postcodeCoverage.findUnique.mockResolvedValue(null);
    const result = await provider.qualify({ ...address, postcode: '5002' });
    expect(result.status).toBe(CoverageResultStatus.NOT_AVAILABLE);
    expect(prisma.postcodeCoverage.findUnique).toHaveBeenCalledWith({
      where: {
        operatingRegionId_postcode: { operatingRegionId: region.id, postcode: '5002' },
      },
    });
  });

  it.each([
    [PostcodeCoverageStatus.PARTIAL, CoverageResultStatus.MANUAL_REVIEW],
    [PostcodeCoverageStatus.COMING_SOON, CoverageResultStatus.COMING_SOON],
    [PostcodeCoverageStatus.UNAVAILABLE, CoverageResultStatus.NOT_AVAILABLE],
  ])('maps postcode %s to %s', async (postcodeStatus, expected) => {
    const { prisma, provider } = setup();
    prisma.postcodeCoverage.findUnique.mockResolvedValue({
      ...availablePostcode,
      status: postcodeStatus,
    });
    expect((await provider.qualify(address)).status).toBe(expected);
  });

  it('returns only technology and speed-compatible public plans', async () => {
    const { provider } = setup();
    const result = await provider.qualify(address);
    expect(result.status).toBe(CoverageResultStatus.AVAILABLE);
    expect(result.plans.map((plan) => plan.id)).toEqual(['essential-id']);
  });

  it('returns manual review when no compatible plan exists', async () => {
    const { prisma, provider } = setup();
    prisma.internetPlan.findMany.mockResolvedValue([]);
    const result = await provider.qualify(address);
    expect(result.status).toBe(CoverageResultStatus.MANUAL_REVIEW);
    expect(result.plans).toEqual([]);
  });
});
