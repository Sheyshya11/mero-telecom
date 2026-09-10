export interface AdminDashboard {
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
  attention: Array<{
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
  }>;
  invoiceTrend: Array<{ month: string; label: string; totalCents: number; count: number }>;
  subscriptionsByStatus: Array<{
    status:
      | 'PENDING'
      | 'ACTIVE'
      | 'CANCELLATION_PENDING'
      | 'DISCONNECTION_PENDING'
      | 'SUSPENDED'
      | 'CANCELLED';
    count: number;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    totalCents: number;
    status: string;
    paymentStatus: string | null;
    customerName: string;
  }>;
  recentActivity: Array<{
    id: string;
    kind: 'CUSTOMER' | 'SUBSCRIPTION' | 'INVOICE' | 'PAYMENT' | 'REFUND' | 'PLAN_CHANGE';
    title: string;
    description: string;
    occurredAt: string;
    amountCents: number | null;
    href: string;
    tone: 'positive' | 'warning' | 'neutral';
  }>;
}

export interface SuperAdminDashboard {
  business: AdminDashboard['metrics'];
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
  attention: Array<{
    type: string;
    count: number;
    title: string;
    description: string;
    actionLabel: string;
    actionUrl: string;
    severity: 'warning' | 'critical';
  }>;
  invoiceTrend: AdminDashboard['invoiceTrend'];
  subscriptionsByStatus: AdminDashboard['subscriptionsByStatus'];
  recentPrivilegedActivity: Array<{
    id: string;
    title: string;
    description: string;
    occurredAt: string;
    href: string;
    tone: 'positive' | 'warning' | 'neutral';
  }>;
  recentBusinessActivity: AdminDashboard['recentActivity'];
  systemHealth: Array<{
    name: 'Database' | 'Redis';
    status: 'HEALTHY' | 'DEGRADED';
    description: string;
  }>;
  observedAt: string;
}
