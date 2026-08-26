export type CoverageResultStatus =
  | 'AVAILABLE'
  | 'COMING_SOON'
  | 'NOT_AVAILABLE'
  | 'OUTSIDE_OPERATING_REGION'
  | 'MANUAL_REVIEW';

export interface AddressSuggestion {
  selectionToken: string;
  formattedAddress: string;
  suburb: string | null;
  state: string | null;
  stateCode: string | null;
  postcode: string | null;
}

export interface CoveragePlan {
  id: string;
  name: string;
  description: string | null;
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
}

export interface CoverageResult {
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
    technology: string | null;
    maximumSpeedMbps: number | null;
    source: 'DATABASE_ESTIMATE';
    checkedAt: string;
  };
  plans: CoveragePlan[];
  qualificationToken: string | null;
}

export interface PublicCheckoutContext {
  planId: string;
  serviceAddress: {
    formattedAddress: string;
    suburb: string | null;
    stateCode: string | null;
    postcode: string | null;
  };
  qualification: {
    technology: NonNullable<CoverageResult['qualification']['technology']>;
    maximumSpeedMbps: number;
    source: 'DATABASE_ESTIMATE';
    checkedAt: string;
  };
  expiresAt: string;
}

export interface AddressSuggestionsResponse {
  suggestions: AddressSuggestion[];
}
