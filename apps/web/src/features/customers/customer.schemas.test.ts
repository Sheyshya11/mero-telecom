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
  it.each([
    ['0400 000 000', '0400000000'],
    ['(0400) 000-000', '0400000000'],
    [' +61 400 000 000 ', '+61400000000'],
  ])('accepts mobile %s without requiring a format', (phone, expected) => {
    expect(customerSchema.parse({ ...validCustomer, phone }).phone).toBe(expected);
  });

  it.each(['not a number', '0400', '0400abc000000'])('rejects invalid mobile %s', (phone) => {
    expect(customerSchema.safeParse({ ...validCustomer, phone }).success).toBe(false);
  });

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
