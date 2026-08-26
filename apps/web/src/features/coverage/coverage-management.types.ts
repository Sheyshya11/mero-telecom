export type AccessTechnology = 'FTTP' | 'FTTN' | 'FTTC' | 'HFC' | 'FIXED_WIRELESS' | 'SATELLITE';
export type OperatingRegionStatus = 'ACTIVE' | 'COMING_SOON' | 'DISABLED';
export type PostcodeCoverageStatus = 'AVAILABLE' | 'PARTIAL' | 'COMING_SOON' | 'UNAVAILABLE';
export type AddressOverrideStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'MANUAL_REVIEW';

export interface OperatingRegion {
  id: string;
  countryCode: string;
  stateCode: string;
  name: string;
  status: OperatingRegionStatus;
  _count: { postcodeCoverage: number; addressOverrides: number };
}

export interface PostcodeCoverage {
  id: string;
  operatingRegionId: string;
  postcode: string;
  status: PostcodeCoverageStatus;
  technology: AccessTechnology | null;
  maximumSpeedMbps: number | null;
  availabilityDate: string | null;
  isActive: boolean;
  adminNotes: string | null;
  operatingRegion: OperatingRegion;
}

export interface AddressCoverageOverride {
  id: string;
  operatingRegionId: string;
  provider: string;
  providerAddressId: string;
  formattedAddress: string;
  stateCode: string;
  postcode: string;
  status: AddressOverrideStatus;
  technology: AccessTechnology | null;
  maximumSpeedMbps: number | null;
  availabilityDate: string | null;
  isActive: boolean;
  adminNotes: string | null;
  operatingRegion: OperatingRegion;
}

export interface InternetPlan {
  id: string;
  name: string;
  downloadMbps: number;
  isActive: boolean;
}

export interface PlanCoverageRule {
  id: string;
  planId: string;
  technology: AccessTechnology;
  minimumSpeedMbps: number | null;
  maximumSpeedMbps: number | null;
  operatingRegionId: string | null;
  postcode: string | null;
  isActive: boolean;
  plan: InternetPlan;
  operatingRegion: OperatingRegion | null;
}

export interface CoverageAnalytics {
  periodDays: number;
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  byState: Array<{ stateCode: string | null; count: number }>;
  recent: Array<{
    id: string;
    requestIdentifier: string;
    resultStatus: string;
    stateCode: string | null;
    postcode: string | null;
    technology: AccessTechnology | null;
    plansReturned: boolean;
    createdAt: string;
  }>;
}
