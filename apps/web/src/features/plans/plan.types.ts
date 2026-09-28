export interface InternetPlan {
  id: string;
  name: string;
  description: string | null;
  highlights: string[];
  downloadMbps: number;
  uploadMbps: number;
  monthlyCents: number;
  stripePriceId: string | null;
  isActive: boolean;
  isPublic: boolean;
  isAvailable: boolean;
  isFeatured: boolean;
  tierRank: number;
  createdAt: string;
  updatedAt: string;
}

export type PublicInternetPlan = Pick<
  InternetPlan,
  | 'id'
  | 'name'
  | 'description'
  | 'highlights'
  | 'downloadMbps'
  | 'uploadMbps'
  | 'monthlyCents'
  | 'isFeatured'
>;

export type PlanLifecycle = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'RETIRED';
