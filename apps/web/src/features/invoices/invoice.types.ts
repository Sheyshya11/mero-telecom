export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  customer: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  subscription: {
    id: string;
    plan: { id: string; name: string };
  } | null;
  payments: Array<{ id: string; status: string }>;
}

export interface InvoiceList {
  data: Invoice[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface InvoiceSubscription {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  customer: { customerNumber: string; firstName: string; lastName: string };
  plan: { name: string; monthlyCents: number };
}
