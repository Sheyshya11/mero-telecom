import { apiRequest } from '../../lib/api/client';
import type { CustomerFormValues } from './customer.schemas';
import type { Customer, PaginatedCustomers } from './customer.types';

export function getCustomers(
  accessToken: string,
  page: number,
  search: string,
): Promise<PaginatedCustomers> {
  const params = new URLSearchParams({ page: String(page), limit: '10' });

  if (search) {
    params.set('search', search);
  }

  return apiRequest<PaginatedCustomers>(`/customers?${params.toString()}`, {}, accessToken);
}

export function createCustomer(accessToken: string, input: CustomerFormValues): Promise<Customer> {
  const customerInput = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    suburb: input.suburb,
    state: input.state,
    postcode: input.postcode,
  };

  return apiRequest<Customer>(
    '/customers',
    { method: 'POST', body: JSON.stringify(customerInput) },
    accessToken,
  );
}

export function updateCustomer(
  accessToken: string,
  customerId: string,
  input: CustomerFormValues,
): Promise<Customer> {
  return apiRequest<Customer>(
    `/customers/${customerId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
    accessToken,
  );
}
