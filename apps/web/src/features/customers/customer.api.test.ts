import { describe, it, expect, vi } from 'vitest';
import { apiRequest } from '../../lib/api/client';
import { updateCustomer } from './customer.api';
import type { CustomerFormValues } from './customer.schemas';
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn().mockResolvedValue({}) }));
describe('Admin customer update payload', () => {
  it('omits the protected email from edit requests', async () => {
    await updateCustomer('token', 'customer', {
      email: 'replacement@example.test',
      phone: '0400000000',
    } as CustomerFormValues);
    expect(apiRequest).toHaveBeenCalledWith(
      '/customers/customer',
      { method: 'PATCH', body: JSON.stringify({ phone: '0400000000', addressLine2: null }) },
      'token',
    );
  });
});
