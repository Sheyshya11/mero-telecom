export interface AdminDashboard {
  metrics: {
    customerCount: number;
    activeSubscriptions: number;
    monthlyRecurringRevenueCents: number;
    outstandingInvoiceCents: number;
    overdueInvoiceCount: number;
  };
  invoiceTrend: Array<{ month: string; label: string; totalCents: number; count: number }>;
  subscriptionsByStatus: Array<{
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
    count: number;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    totalCents: number;
    status: string;
    customerName: string;
  }>;
}
