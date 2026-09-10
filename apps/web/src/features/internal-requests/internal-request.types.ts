export type InternalRequestType =
  | 'REFUND_REVIEW'
  | 'BILLING_REVIEW'
  | 'SUBSCRIPTION_ACTION'
  | 'CUSTOMER_ACCOUNT_ACTION'
  | 'PLAN_CHANGE_REVIEW'
  | 'SUPPORT_ASSISTANCE'
  | 'OTHER';

export type InternalRequestStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'MORE_INFO_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESOLVED'
  | 'CLOSED';

export type InternalRequestPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type InternalRequestLevel = 'ADMIN' | 'SUPER_ADMIN';

export interface InternalRequestAttachment {
  id: string;
  messageId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface InternalRequestEvent {
  id: string;
  eventType:
    | 'CREATED'
    | 'ASSIGNED'
    | 'REVIEW_STARTED'
    | 'MESSAGE_SENT'
    | 'MORE_INFO_REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'ESCALATED'
    | 'RETURNED'
    | 'RESOLVED'
    | 'CLOSED';
  actorRole: 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';
  fromLevel: InternalRequestLevel | null;
  toLevel: InternalRequestLevel | null;
  comment: string | null;
  createdAt: string;
  actor: { id: string; displayName: string | null; email: string };
}

export interface InternalRequestMessage {
  id: string;
  body: string;
  senderRole: 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';
  createdAt: string;
  updatedAt: string;
  sender: { id: string; displayName: string | null; email: string };
  attachments: InternalRequestAttachment[];
}

export interface InternalRequest {
  id: string;
  requestNumber: string;
  requesterRole: 'STAFF';
  targetRole: 'ADMIN';
  currentLevel: InternalRequestLevel;
  type: InternalRequestType;
  title: string;
  description?: string;
  priority: InternalRequestPriority;
  status: InternalRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  requestedBy: { id: string; displayName: string | null; email: string };
  assignedTo: { id: string; displayName: string | null; email: string } | null;
  superAdminAssignedTo: { id: string; displayName: string | null; email: string } | null;
  escalatedBy: { id: string; displayName: string | null; email: string } | null;
  escalatedAt: string | null;
  reviewedBy: { id: string; displayName: string | null; email: string } | null;
  customer: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  supportCase: { id: string; caseNumber: string; subject: string; status: string } | null;
  subscription: { id: string; status: string; plan: { id: string; name: string } } | null;
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    totalCents: number;
    currency: string;
  } | null;
  payment: {
    id: string;
    providerPaymentId: string | null;
    status: string;
    amountCents: number;
    currency: string;
  } | null;
  refund: {
    id: string;
    status: string;
    reason: string;
    refundAmountCents: number;
    currency: string;
  } | null;
  planChangeRequest: {
    id: string;
    status: string;
    type: string;
    targetPlan: { id: string; name: string };
  } | null;
  messages?: InternalRequestMessage[];
  events?: InternalRequestEvent[];
  capabilities?: {
    canTake: boolean;
    canStartReview: boolean;
    canRequestInfo: boolean;
    canApprove: boolean;
    canReject: boolean;
    canEscalate: boolean;
    canReturnToAdmin: boolean;
    canResolve: boolean;
    canClose: boolean;
    canComment: boolean;
    unavailableReason: string | null;
  };
}

export interface InternalRequestList {
  data: InternalRequest[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface InternalRequestContextOptions {
  selectedCustomerId: string | null;
  selectedSupportCaseId: string | null;
  customers: Array<{
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
  supportCases: Array<{ id: string; caseNumber: string; subject: string; status: string }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    totalCents: number;
    currency: string;
  }>;
  payments: Array<{
    id: string;
    providerPaymentId: string | null;
    status: string;
    amountCents: number;
    currency: string;
  }>;
  refunds: Array<{
    id: string;
    status: string;
    reason: string;
    refundAmountCents: number;
    currency: string;
  }>;
  subscriptions: Array<{
    id: string;
    status: string;
    plan: { id: string; name: string };
  }>;
  planChanges: Array<{
    id: string;
    status: string;
    type: string;
    targetPlan: { id: string; name: string };
  }>;
}

export const internalRequestTypes: ReadonlyArray<{
  value: InternalRequestType;
  label: string;
}> = [
  { value: 'REFUND_REVIEW', label: 'Refund Review' },
  { value: 'BILLING_REVIEW', label: 'Billing Review' },
  { value: 'SUBSCRIPTION_ACTION', label: 'Subscription Action' },
  { value: 'CUSTOMER_ACCOUNT_ACTION', label: 'Customer Account Action' },
  { value: 'PLAN_CHANGE_REVIEW', label: 'Plan Change Review' },
  { value: 'SUPPORT_ASSISTANCE', label: 'Support Assistance' },
  { value: 'OTHER', label: 'Other' },
];

export const internalRequestStatuses: ReadonlyArray<{
  value: InternalRequestStatus;
  label: string;
}> = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'MORE_INFO_REQUIRED', label: 'Needs Information' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export const internalRequestPriorities: ReadonlyArray<{
  value: InternalRequestPriority;
  label: string;
}> = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
];

export function internalRequestTypeLabel(value: InternalRequestType): string {
  return internalRequestTypes.find((item) => item.value === value)?.label ?? value;
}

export function internalRequestStatusLabel(value: InternalRequestStatus): string {
  return internalRequestStatuses.find((item) => item.value === value)?.label ?? value;
}

export function internalRequestLevelLabel(value: InternalRequestLevel): string {
  return value === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin';
}

export function formatInternalRequestDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function personLabel(person: { displayName: string | null; email: string }): string {
  return person.displayName || person.email;
}
