export interface CustomerDashboard {
  profile: {
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  subscription: {
    id: string;
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
    startDate: string;
    plan: {
      name: string;
      downloadMbps: number;
      uploadMbps: number;
      monthlyCents: number;
    };
  } | null;
  billing: {
    nextPaymentAmountCents: number | null;
    nextBillingDate: string | null;
    outstandingInvoiceCents: number;
    latestPaymentStatus: CustomerPaymentStatus | null;
  };
  pendingAction: {
    type: 'SERVICE' | 'PAYMENT' | 'PLAN_CHANGE' | 'REFUND';
    title: string;
    description: string;
    actionLabel: string;
    actionUrl: string;
    severity: 'warning' | 'critical';
  } | null;
  recentActivity: Array<{
    id: string;
    kind: 'PAYMENT' | 'INVOICE' | 'REFUND' | 'PLAN_CHANGE' | 'SUBSCRIPTION';
    title: string;
    description: string;
    occurredAt: string;
    amountCents: number | null;
    href: string;
    tone: 'positive' | 'warning' | 'neutral';
  }>;
  latestInvoice: CustomerInvoice | null;
  invoices: CustomerInvoice[];
}

export type CustomerPaymentStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  paymentStatus: CustomerPaymentStatus | null;
  payment?: {
    amountCents: number;
    id: string;
    status: CustomerPaymentStatus;
    refundedCents: number;
    currency: string;
    paidAt: string | null;
  } | null;
}
