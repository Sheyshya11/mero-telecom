import {
  AddressType,
  type AccountInvitationStatus,
  type Customer,
  type CustomerStatus,
  type SubscriptionStatus,
  type UserStatus,
} from '@prisma/client';

interface CustomerWithSubscriptions extends Customer {
  user?: {
    status: UserStatus;
    invitations?: Array<{ status: AccountInvitationStatus; expiresAt: Date }>;
  } | null;
  addresses?: Array<{
    type: AddressType;
    addressLine1: string;
    addressLine2: string | null;
    suburb: string;
    state: string;
    postcode: string;
  }>;
  subscriptions?: Array<{
    status: SubscriptionStatus;
    plan: { id: string; name: string };
    currentServiceAddress?: CustomerAddressResponse | null;
  }>;
}

export interface CustomerAddressResponse {
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
}

export interface CustomerResponse {
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
  accountStatus: UserStatus | null;
  invitationStatus: AccountInvitationStatus | null;
  serviceAddress: CustomerAddressResponse | null;
  contactAddress: CustomerAddressResponse;
  currentSubscription: {
    status: SubscriptionStatus;
    plan: { id: string; name: string };
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerCreationResponse extends CustomerResponse {
  invitationQueued: boolean;
}

export interface PaginatedCustomersResponse {
  data: CustomerResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function toCustomerResponse(customer: CustomerWithSubscriptions): CustomerResponse {
  const invitation = customer.user?.invitations?.[0];
  const currentSubscription = customer.subscriptions?.[0] ?? null;
  const legacyServiceAddress = customer.addresses?.find(
    (address) => address.type === AddressType.SERVICE,
  );
  const billingAddress = customer.addresses?.find(
    (address) => address.type === AddressType.BILLING,
  );
  const profileAddress = {
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    suburb: customer.suburb,
    state: customer.state,
    postcode: customer.postcode,
  };
  return {
    id: customer.id,
    customerNumber: customer.customerNumber,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    suburb: customer.suburb,
    state: customer.state,
    postcode: customer.postcode,
    status: customer.status,
    accountStatus: customer.user?.status ?? null,
    invitationStatus:
      invitation?.status === 'PENDING' && invitation.expiresAt <= new Date()
        ? 'EXPIRED'
        : (invitation?.status ?? null),
    serviceAddress: currentSubscription?.currentServiceAddress ?? legacyServiceAddress ?? null,
    contactAddress: billingAddress ?? profileAddress,
    currentSubscription,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}
