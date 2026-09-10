export type SupportCategory =
  | 'INTERNET_CONNECTION'
  | 'BILLING'
  | 'PLAN'
  | 'ACCOUNT'
  | 'REFUND'
  | 'PLANS_AND_PRICING'
  | 'NBN_AVAILABILITY'
  | 'ADDRESS_CHECK'
  | 'SIGNUP_HELP'
  | 'ORDER_HELP'
  | 'PAYMENT_HELP'
  | 'GENERAL_ENQUIRY'
  | 'OTHER';

export type SupportRequestType = 'CUSTOMER_SUPPORT' | 'PROSPECT_ENQUIRY';

export type SupportStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface SupportAttachment {
  id: string;
  messageId: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  body: string;
  senderRole: 'CUSTOMER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';
  visibility: 'CUSTOMER_VISIBLE' | 'INTERNAL';
  emailDeliveryStatus: 'NOT_APPLICABLE' | 'QUEUED' | 'SENT' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  sender?: { id: string; displayName: string | null; email: string };
  attachments: SupportAttachment[];
}

export interface SupportCase {
  id: string;
  caseNumber: string;
  requestType: SupportRequestType;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  prospectName?: string | null;
  prospectEmail?: string | null;
  prospectPhone?: string | null;
  prospectAddress?: string | null;
  linkedCustomerAt?: string | null;
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  assignedTo: { id?: string; displayName: string | null; email?: string } | null;
  messages?: SupportMessage[];
  capabilities?: {
    canTake: boolean;
    canResolve: boolean;
    canClose: boolean;
    canReopen: boolean;
    canSetWaitingForCustomer: boolean;
    canChangePriority: boolean;
    canReply: boolean;
    resolutionBlockedReason: string | null;
  };
  workflow?: {
    resolutionBlockedReason: string | null;
    blockingInternalRequests: Array<{
      requestNumber: string;
      currentLevel: 'ADMIN' | 'SUPER_ADMIN';
      status: 'PENDING' | 'IN_REVIEW' | 'MORE_INFO_REQUIRED' | 'APPROVED' | 'REJECTED';
    }>;
  };
  activity?: Array<{
    id: string;
    action: string;
    createdAt: string;
    actorName: string;
    metadata: unknown;
  }>;
}

export interface SupportList {
  data: SupportCase[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const customerSupportCategories: ReadonlyArray<{
  value: SupportCategory;
  label: string;
}> = [
  { value: 'INTERNET_CONNECTION', label: 'Internet / Connection' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'PLAN', label: 'Plan' },
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'OTHER', label: 'Other' },
];

export const prospectSupportCategories: ReadonlyArray<{
  value: SupportCategory;
  label: string;
}> = [
  { value: 'PLANS_AND_PRICING', label: 'Plans & Pricing' },
  { value: 'NBN_AVAILABILITY', label: 'NBN Availability' },
  { value: 'ADDRESS_CHECK', label: 'Address Check' },
  { value: 'SIGNUP_HELP', label: 'Signup Help' },
  { value: 'ORDER_HELP', label: 'Order Help' },
  { value: 'PAYMENT_HELP', label: 'Payment Help' },
  { value: 'GENERAL_ENQUIRY', label: 'General Enquiry' },
  { value: 'OTHER', label: 'Other' },
];

export const supportCategories = [
  ...customerSupportCategories,
  ...prospectSupportCategories,
].filter(
  (item, index, items) => items.findIndex((candidate) => candidate.value === item.value) === index,
);

export const supportStatuses: ReadonlyArray<{ value: SupportStatus; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_FOR_CUSTOMER', label: 'Waiting for customer' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export function categoryLabel(value: SupportCategory): string {
  return supportCategories.find((item) => item.value === value)?.label ?? value;
}

export function statusLabel(value: SupportStatus, customer = false): string {
  if (customer && value === 'WAITING_FOR_CUSTOMER') return 'Waiting for you';
  return supportStatuses.find((item) => item.value === value)?.label ?? value;
}

export function formatSupportDate(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export const acceptedSupportFileTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export function validateSupportFiles(files: File[]): string | null {
  if (files.length > 3) return 'You can attach up to 3 files.';
  if (files.some((file) => !acceptedSupportFileTypes.includes(file.type as never))) {
    return 'Only images, PDF, and Word documents are supported.';
  }
  if (files.some((file) => file.size > 10 * 1024 * 1024)) {
    return 'Each attachment must be 10 MB or smaller.';
  }
  if (files.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) {
    return 'Attachments must be 20 MB or smaller in total.';
  }
  return null;
}
