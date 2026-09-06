export type RefundStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'UNDER_REVIEW'
  | 'MORE_INFORMATION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type RefundType = 'FULL' | 'PARTIAL';
export type RefundReason =
  | 'DUPLICATE_PAYMENT'
  | 'SERVICE_UNAVAILABLE'
  | 'BILLING_ERROR'
  | 'CANCELLED_BEFORE_ACTIVATION'
  | 'SERVICE_ISSUE'
  | 'GOODWILL'
  | 'OTHER';

export interface RefundRecord {
  id: string;
  paymentId: string;
  invoiceId: string | null;
  subscriptionId: string | null;
  originalAmountCents: number;
  refundAmountCents: number;
  currency: string;
  type: RefundType;
  reason: RefundReason;
  customerReason: string | null;
  internalNote?: string | null;
  status: RefundStatus;
  stripePaymentIntentId?: string;
  stripeRefundId?: string | null;
  failureReason: string | null;
  customerMessage?: string | null;
  requestedAt: string;
  approvedAt: string | null;
  processedAt: string | null;
  rejectedAt: string | null;
  failedAt: string | null;
  customer?: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  payment: {
    id: string;
    amountCents: number;
    refundedCents: number;
    currency: string;
    status: string;
    paidAt: string | null;
    providerPaymentId?: string | null;
  };
  invoice: { id: string; invoiceNumber: string; totalCents: number; status: string } | null;
  subscription: {
    id: string;
    status: string;
    plan: { id: string; name: string };
  } | null;
  refundableSummary?: {
    amountCents: number;
    successfulCents: number;
    reservedCents: number;
    remainingCents: number;
  } | null;
  auditTimeline?: Array<{
    id: string;
    action: string;
    createdAt: string;
    metadata: Record<string, unknown> | null;
    actor: { email: string; displayName: string | null; role: string } | null;
  }>;
  attachments?: RefundAttachment[];
}

export interface RefundAttachment {
  id: string;
  refundId?: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedByRole: string;
  uploadedBy?: { email: string; displayName: string | null };
  createdAt: string;
}

export interface RefundList {
  data: RefundRecord[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const refundReasons: Array<{ value: RefundReason; label: string }> = [
  { value: 'DUPLICATE_PAYMENT', label: 'Duplicate payment' },
  { value: 'SERVICE_UNAVAILABLE', label: 'Service not activated' },
  { value: 'BILLING_ERROR', label: 'Billing error' },
  { value: 'CANCELLED_BEFORE_ACTIVATION', label: 'Cancelled before activation' },
  { value: 'SERVICE_ISSUE', label: 'Service issue' },
  { value: 'GOODWILL', label: 'Goodwill' },
  { value: 'OTHER', label: 'Other' },
];

export function formatRefundMoney(cents: number, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}

export function humanizeRefundValue(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function partialRefundAmountCents(value: string, maximumCents: number): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [dollars, cents = ''] = value.trim().split('.');
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= maximumCents ? amount : null;
}
