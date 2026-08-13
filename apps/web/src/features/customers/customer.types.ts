export type CustomerStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface Customer {
  id: string;
  customerNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  status: CustomerStatus;
  currentSubscription: {
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
    plan: { id: string; name: string };
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedCustomers {
  data: Customer[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
