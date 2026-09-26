import type { CoveragePlan, CoverageResult } from '../coverage/coverage.types';

export type RelocationStatus =
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PROVISIONING'
  | 'SCHEDULED'
  | 'PARTIALLY_COMPLETED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'FORCE_CLOSED';

export interface ServiceAddress {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  technology: string | null;
  maximumSpeedMbps: number | null;
  serviceClass?: string | null;
}

export interface RelocationPlan extends CoveragePlan {
  isActive: boolean;
  isPublic: boolean;
  isAvailable: boolean;
}

export interface ServiceRelocation {
  id: string;
  subscriptionId: string;
  status: RelocationStatus;
  requestedMoveDate: string;
  requestedOldServiceDisconnectionDate: string | null;
  qualificationStatus: CoverageResult['status'];
  provisioningStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | null;
  oldServiceDisconnectionStatus:
    | 'NOT_SUBMITTED'
    | 'PENDING'
    | 'COMPLETED'
    | 'FAILED'
    | 'MANUAL_REVIEW_REQUIRED'
    | 'CANCELLED'
    | null;
  failureReason: string | null;
  disconnectionFailureReason: string | null;
  oldServiceAddress: ServiceAddress;
  newServiceAddress: ServiceAddress;
  currentPlan: RelocationPlan;
  requestedPlan: RelocationPlan;
  confirmedAt: string | null;
  newServiceActivatedAt: string | null;
  oldServiceDisconnectedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  disconnectionAttemptCount: number;
  canConfirm: boolean;
  canCancel: boolean;
  canRetry: boolean;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  subscription?: { id: string; status: string; currentServiceAddressId: string | null };
  providerMode?: 'SIMULATED' | 'LIVE';
  providerName?: string;
  providerReference?: string | null;
  disconnectionProviderReference?: string | null;
  notes?: RelocationNote[];
  auditHistory?: RelocationAuditEvent[];
  billing?: RelocationBilling | null;
  escalation?: RelocationEscalation | null;
  capabilities?: RelocationCapabilities;
}

export interface RelocationNote {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
  author: { id: string; displayName: string | null; email: string };
}

export interface RelocationAuditEvent {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; displayName: string | null; email: string } | null;
}

export interface RelocationBilling {
  id: string;
  invoiceNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  payments: Array<{
    id: string;
    status: string;
    provider: string;
    amountCents: number;
    paidAt: string | null;
  }>;
}

export interface RelocationEscalation {
  id: string;
  requestNumber: string;
  status: string;
  priority: string;
  createdAt: string;
  escalatedAt: string | null;
  events: Array<{ comment: string | null; createdAt: string }>;
}

export interface RelocationCapabilities {
  canAddNote: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  canRetryQualification: boolean;
  canRetryProvisioning: boolean;
  canRetryDisconnection: boolean;
  canReschedule: boolean;
  canEscalate: boolean;
  canConfigureDemo: boolean;
  canSimulateProvisioning: boolean;
  canSimulateDisconnection: boolean;
  canOverride: boolean;
  maxProvisioningAttempts: number;
  maxDisconnectionAttempts: number;
}

export interface RelocationQualification extends CoverageResult {
  currentPlanCompatible: boolean;
  currentPlanId: string;
}

export interface RelocationSubscription {
  id: string;
  status: string;
  plan: CoveragePlan;
  currentServiceAddress: ServiceAddress | null;
}
