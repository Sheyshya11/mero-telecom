import type { AccessTechnology, CoverageResultStatus } from '@prisma/client';

export type AddressProviderName = 'geoapify';

export type NormalizedAddressSuggestion = {
  provider: AddressProviderName;
  providerAddressId: string;
  formattedAddress: string;
  unit: string | null;
  houseNumber: string | null;
  street: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  postcode: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
};

export type PublicAddressSuggestion = Pick<
  NormalizedAddressSuggestion,
  'formattedAddress' | 'suburb' | 'state' | 'stateCode' | 'postcode'
> & {
  selectionToken: string;
};

export interface AddressLookupProvider {
  search(query: string): Promise<NormalizedAddressSuggestion[]>;
}

export interface QualifiedPlan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

export interface PublicCoverageResult {
  available: boolean;
  status: CoverageResultStatus;
  message: string;
  address: {
    formattedAddress: string;
    suburb: string | null;
    stateCode: string | null;
    postcode: string | null;
  };
  qualification: {
    technology: AccessTechnology | null;
    maximumSpeedMbps: number | null;
    source: 'DATABASE_ESTIMATE';
    checkedAt: string;
  };
  plans: QualifiedPlan[];
}

export interface CoverageCheckResult extends PublicCoverageResult {
  qualificationToken: string | null;
}

export interface TrustedCoverageQualification {
  address: NormalizedAddressSuggestion;
  compatiblePlanIds: string[];
  technology: AccessTechnology;
  maximumSpeedMbps: number;
  checkedAt: string;
  expiresAt: string;
}

export interface CoverageQualificationDecision extends PublicCoverageResult {
  operatingRegionId: string | null;
}

export interface CoverageQualificationProvider {
  qualify(address: NormalizedAddressSuggestion): Promise<CoverageQualificationDecision>;
}

export const ADDRESS_LOOKUP_PROVIDER = Symbol('ADDRESS_LOOKUP_PROVIDER');
export const COVERAGE_QUALIFICATION_PROVIDER = Symbol('COVERAGE_QUALIFICATION_PROVIDER');
