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
  outstandingInvoiceCents: number;
  latestInvoice: CustomerInvoice | null;
  invoices: CustomerInvoice[];
}

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | null;
  payment?: {
    amountCents: number;
    id: string;
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
    refundedCents: number;
    currency: string;
    paidAt: string | null;
  } | null;
}
