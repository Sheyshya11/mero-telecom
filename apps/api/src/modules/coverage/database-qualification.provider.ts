import { Injectable } from '@nestjs/common';
import {
  AddressOverrideStatus,
  CoverageResultStatus,
  OperatingRegionStatus,
  PostcodeCoverageStatus,
  type AccessTechnology,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { normalizeAustralianStateCode } from './australian-states';
import type {
  CoverageQualificationDecision,
  CoverageQualificationProvider,
  NormalizedAddressSuggestion,
  QualifiedPlan,
} from './coverage.types';

@Injectable()
export class DatabaseCoverageQualificationProvider implements CoverageQualificationProvider {
  constructor(private readonly prisma: PrismaService) {}

  async qualify(address: NormalizedAddressSuggestion): Promise<CoverageQualificationDecision> {
    const checkedAt = new Date().toISOString();
    const stateCode = normalizeAustralianStateCode(address.stateCode, address.state);
    const countryCode = address.countryCode?.trim().toUpperCase() ?? null;
    if (countryCode !== 'AU') {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.OUTSIDE_OPERATING_REGION,
        'Mero Telecom currently checks service only for Australian addresses.',
        checkedAt,
      );
    }

    const region = stateCode
      ? await this.prisma.operatingRegion.findUnique({
          where: { countryCode_stateCode: { countryCode: 'AU', stateCode } },
        })
      : null;
    if (!region || region.status === OperatingRegionStatus.DISABLED) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.OUTSIDE_OPERATING_REGION,
        'Mero Telecom does not currently operate in this state.',
        checkedAt,
      );
    }
    if (region.status === OperatingRegionStatus.COMING_SOON) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.COMING_SOON,
        'Mero Telecom service is planned for this state but is not yet orderable.',
        checkedAt,
        region.id,
      );
    }

    const override = await this.prisma.addressCoverageOverride.findUnique({
      where: {
        provider_providerAddressId: {
          provider: address.provider,
          providerAddressId: address.providerAddressId,
        },
      },
    });
    if (override?.isActive && override.operatingRegionId === region.id) {
      if (override.status === AddressOverrideStatus.UNAVAILABLE) {
        return this.decision(
          address,
          stateCode,
          CoverageResultStatus.NOT_AVAILABLE,
          'Mero Telecom service is not currently available at this address.',
          checkedAt,
          region.id,
        );
      }
      if (override.status === AddressOverrideStatus.MANUAL_REVIEW) {
        return this.decision(
          address,
          stateCode,
          CoverageResultStatus.MANUAL_REVIEW,
          'This address needs manual serviceability review before an order can be accepted.',
          checkedAt,
          region.id,
          override.technology,
          override.maximumSpeedMbps,
        );
      }
      return this.availableDecision(
        address,
        stateCode,
        region.id,
        override.technology,
        override.maximumSpeedMbps,
        checkedAt,
      );
    }

    if (!address.postcode) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.NOT_AVAILABLE,
        'A recognised postcode is required to estimate Mero Telecom availability.',
        checkedAt,
        region.id,
      );
    }
    const postcodeCoverage = await this.prisma.postcodeCoverage.findUnique({
      where: {
        operatingRegionId_postcode: {
          operatingRegionId: region.id,
          postcode: address.postcode,
        },
      },
    });
    if (!postcodeCoverage?.isActive) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.NOT_AVAILABLE,
        'Mero Telecom has no active service record for this exact postcode.',
        checkedAt,
        region.id,
      );
    }
    if (postcodeCoverage.status === PostcodeCoverageStatus.COMING_SOON) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.COMING_SOON,
        'Mero Telecom service is planned for this postcode but is not yet orderable.',
        checkedAt,
        region.id,
        postcodeCoverage.technology,
        postcodeCoverage.maximumSpeedMbps,
      );
    }
    if (postcodeCoverage.status === PostcodeCoverageStatus.PARTIAL) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.MANUAL_REVIEW,
        'Coverage varies within this postcode, so this address needs manual review.',
        checkedAt,
        region.id,
        postcodeCoverage.technology,
        postcodeCoverage.maximumSpeedMbps,
      );
    }
    if (postcodeCoverage.status === PostcodeCoverageStatus.UNAVAILABLE) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.NOT_AVAILABLE,
        'Mero Telecom service is not currently available at this address.',
        checkedAt,
        region.id,
      );
    }
    return this.availableDecision(
      address,
      stateCode,
      region.id,
      postcodeCoverage.technology,
      postcodeCoverage.maximumSpeedMbps,
      checkedAt,
    );
  }

  private async availableDecision(
    address: NormalizedAddressSuggestion,
    stateCode: string | null,
    operatingRegionId: string,
    technology: AccessTechnology | null,
    maximumSpeedMbps: number | null,
    checkedAt: string,
  ): Promise<CoverageQualificationDecision> {
    if (!technology || !maximumSpeedMbps) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.MANUAL_REVIEW,
        'Coverage is indicated, but the access technology or supported speed needs manual review.',
        checkedAt,
        operatingRegionId,
        technology,
        maximumSpeedMbps,
      );
    }

    const plans = await this.compatiblePlans(
      technology,
      maximumSpeedMbps,
      operatingRegionId,
      address.postcode,
    );
    if (!plans.length) {
      return this.decision(
        address,
        stateCode,
        CoverageResultStatus.MANUAL_REVIEW,
        'The address appears serviceable, but no currently purchasable plan matches its technology and speed.',
        checkedAt,
        operatingRegionId,
        technology,
        maximumSpeedMbps,
      );
    }

    return this.decision(
      address,
      stateCode,
      CoverageResultStatus.AVAILABLE,
      'Mero Telecom service is estimated to be available at this address. Final serviceability may require confirmation.',
      checkedAt,
      operatingRegionId,
      technology,
      maximumSpeedMbps,
      plans,
    );
  }

  private async compatiblePlans(
    technology: AccessTechnology,
    qualificationMaximumSpeedMbps: number,
    operatingRegionId: string,
    postcode: string | null,
  ): Promise<QualifiedPlan[]> {
    const candidates = await this.prisma.internetPlan.findMany({
      where: { isActive: true, isPublic: true, isAvailable: true },
      include: {
        coverageRules: {
          where: { technology, isActive: true },
        },
      },
      orderBy: [{ tierRank: 'asc' }, { monthlyCents: 'asc' }],
    });

    return candidates
      .filter((plan) =>
        plan.coverageRules.some((rule) => {
          if (rule.operatingRegionId && rule.operatingRegionId !== operatingRegionId) return false;
          if (rule.postcode && rule.postcode !== postcode) return false;
          if (rule.minimumSpeedMbps && qualificationMaximumSpeedMbps < rule.minimumSpeedMbps) {
            return false;
          }
          const supportedMaximum = Math.min(
            qualificationMaximumSpeedMbps,
            rule.maximumSpeedMbps ?? Number.POSITIVE_INFINITY,
          );
          return plan.downloadMbps <= supportedMaximum;
        }),
      )
      .map(({ id, name, description, downloadMbps, uploadMbps, monthlyCents }) => ({
        id,
        name,
        description,
        downloadMbps,
        uploadMbps,
        monthlyCents,
      }));
  }

  private decision(
    address: NormalizedAddressSuggestion,
    stateCode: string | null,
    status: CoverageResultStatus,
    message: string,
    checkedAt: string,
    operatingRegionId: string | null = null,
    technology: AccessTechnology | null = null,
    maximumSpeedMbps: number | null = null,
    plans: QualifiedPlan[] = [],
  ): CoverageQualificationDecision {
    return {
      available: status === CoverageResultStatus.AVAILABLE,
      status,
      message: `${message} This is a Mero Telecom database estimate, not official nbn confirmation.`,
      address: {
        formattedAddress: address.formattedAddress,
        suburb: address.suburb ?? address.city,
        stateCode,
        postcode: address.postcode,
      },
      qualification: {
        technology,
        maximumSpeedMbps,
        source: 'DATABASE_ESTIMATE',
        checkedAt,
      },
      plans,
      operatingRegionId,
    };
  }
}
