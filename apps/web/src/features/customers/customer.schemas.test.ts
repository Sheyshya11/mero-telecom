import { describe, expect, it } from 'vitest';

import { customerSchema } from './customer.schemas';

const validCustomer = {
  firstName: 'Alex',
  lastName: 'Taylor',
  email: 'alex@example.test',
  phone: '0400000000',
  addressLine1: '10 Example Street',
  addressLine2: '',
  suburb: 'Adelaide',
  state: 'SA',
  postcode: '5000',
};

describe('customerSchema', () => {
  it('trims customer identity and address text', () => {
    const result = customerSchema.parse({
      ...validCustomer,
      firstName: ' Alex ',
      lastName: ' Taylor ',
      addressLine1: ' 10 Example Street ',
      suburb: ' Adelaide ',
    });

    expect(result).toMatchObject({
      firstName: 'Alex',
      lastName: 'Taylor',
      addressLine1: '10 Example Street',
      suburb: 'Adelaide',
    });
  });

  it.each([
    { field: 'state', value: 'XYZ' },
    { field: 'postcode', value: '5000A' },
    { field: 'firstName', value: '   ' },
  ])('rejects invalid $field values', ({ field, value }) => {
    expect(customerSchema.safeParse({ ...validCustomer, [field]: value }).success).toBe(false);
  });
});
