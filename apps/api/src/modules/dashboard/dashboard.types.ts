import type {
  CancellationStatus,
  InvoiceStatus,
  PaymentStatus,
  SubscriptionStatus,
} from '@prisma/client';

export interface AdminDashboardAttentionItem {
  type:
    | 'FAILED_PAYMENTS'
    | 'OVERDUE_INVOICES'
    | 'PENDING_REFUNDS'
    | 'SUSPENDED_SUBSCRIPTIONS'
    | 'PENDING_PLAN_CHANGES';
  count: number;
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  severity: 'warning' | 'critical';
}

export interface AdminDashboardActivity {
  id: string;
  kind: 'CUSTOMER' | 'SUBSCRIPTION' | 'INVOICE' | 'PAYMENT' | 'REFUND' | 'PLAN_CHANGE';
  title: string;
  description: string;
  occurredAt: string;
  amountCents: number | null;
  href: string;
  tone: 'positive' | 'warning' | 'neutral';
}

export interface AdminDashboardSummary {
  metrics: {
    customerCount: number;
    activeSubscriptions: number;
    monthlyRecurringRevenueCents: number;
    outstandingInvoiceCents: number;
    outstandingInvoiceCount: number;
    overdueInvoiceCount: number;
    pendingRefunds: number;
    pendingRefundAmountCents: number;
    failedPaymentCount: number;
  };
  attention: AdminDashboardAttentionItem[];
  invoiceTrend: Array<{
    month: string;
    label: string;
    totalCents: number;
    count: number;
  }>;
  subscriptionsByStatus: Array<{
    status: SubscriptionStatus;
    count: number;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    totalCents: number;
    status: InvoiceStatus;
    paymentStatus: PaymentStatus | null;
    customerName: string;
  }>;
  recentActivity: AdminDashboardActivity[];
}

export interface SuperAdminDashboardAttentionItem {
  type:
    | AdminDashboardAttentionItem['type']
    | 'RESTRICTED_ADMINS'
    | 'RESTRICTED_STAFF'
    | 'PRIVILEGED_ACTIONS_DENIED';
  count: number;
  title: string;
  description: string;
  actionLabel: string;
  actionUrl: string;
  severity: 'warning' | 'critical';
}

export interface SuperAdminDashboardSummary {
  business: AdminDashboardSummary['metrics'];
  organisation: {
    activeSuperAdmins: number;
    activeAdmins: number;
    activeStaff: number;
    restrictedInternalAccounts: number;
    pendingInvitations: number;
  };
  governance: {
    recentRoleChanges: number;
    privilegedActionsToday: number;
    deniedPrivilegedActionsLast24Hours: number;
  };
  attention: SuperAdminDashboardAttentionItem[];
  invoiceTrend: AdminDashboardSummary['invoiceTrend'];
  subscriptionsByStatus: AdminDashboardSummary['subscriptionsByStatus'];
  recentPrivilegedActivity: Array<{
    id: string;
    title: string;
    description: string;
    occurredAt: string;
    href: string;
    tone: 'positive' | 'warning' | 'neutral';
  }>;
  recentBusinessActivity: AdminDashboardActivity[];
  systemHealth: Array<{
    name: 'Database' | 'Redis';
    status: 'HEALTHY' | 'DEGRADED';
    description: string;
  }>;
  observedAt: string;
}

export interface CustomerDashboardInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus | null;
  payment: {
    id: string;
    amountCents: number;
    refundedCents: number;
    currency: string;
    status: PaymentStatus;
    paidAt: string | null;
  } | null;
}

export interface CustomerDashboardActivity {
  id: string;
  kind: 'PAYMENT' | 'INVOICE' | 'REFUND' | 'PLAN_CHANGE' | 'SUBSCRIPTION' | 'CANCELLATION';
  title: string;
  description: string;
  occurredAt: string;
  amountCents: number | null;
  href: string;
  tone: 'positive' | 'warning' | 'neutral';
}

export interface CustomerDashboardSummary {
  profile: {
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  subscription: {
    id: string;
    status: SubscriptionStatus;
    startDate: string;
    pastDueAt: string | null;
    gracePeriodEndsAt: string | null;
    suspendedAt: string | null;
    suspensionReason: 'NON_PAYMENT' | 'ADMINISTRATIVE' | 'FRAUD' | 'COMPLIANCE' | 'OTHER' | null;
    reactivatedAt: string | null;
    provisioningStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | null;
    provisioningFailure: string | null;
    plan: {
      name: string;
      downloadMbps: number;
      uploadMbps: number;
      monthlyCents: number;
    };
  } | null;
  cancellation: {
    requestNumber: string;
    status: CancellationStatus;
    effectiveAt: string;
    canRevoke: boolean;
  } | null;
  billing: {
    nextPaymentAmountCents: number | null;
    nextBillingDate: string | null;
    outstandingInvoiceCents: number;
    latestPaymentStatus: PaymentStatus | null;
  };
  pendingAction: {
    type: 'SERVICE' | 'PAYMENT' | 'PLAN_CHANGE' | 'REFUND' | 'CANCELLATION';
    title: string;
    description: string;
    actionLabel: string;
    actionUrl: string;
    severity: 'warning' | 'critical';
  } | null;
  recentActivity: CustomerDashboardActivity[];
  latestInvoice: CustomerDashboardInvoice | null;
  invoices: CustomerDashboardInvoice[];
}
