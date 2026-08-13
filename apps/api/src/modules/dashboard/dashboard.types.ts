import type { InvoiceStatus, SubscriptionStatus } from '@prisma/client';

export interface AdminDashboardSummary {
  metrics: {
    customerCount: number;
    activeSubscriptions: number;
    monthlyRecurringRevenueCents: number;
    outstandingInvoiceCents: number;
    overdueInvoiceCount: number;
  };
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
    customerName: string;
  }>;
}
