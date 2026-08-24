export type CustomerStatus = 'INVITATION_PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type AccountStatus = 'INVITATION_PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

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
  accountStatus: AccountStatus | null;
  invitationStatus: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | null;
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
