import { describe, expect, it } from 'vitest';

import { humanizeRefundValue, partialRefundAmountCents } from './refund.types';

describe('refund UI money validation', () => {
  it.each([
    ['0.01', 1],
    ['40', 4_000],
    ['40.5', 4_050],
    ['40.50', 4_050],
  ])('parses %s without floating-point arithmetic', (input, expected) => {
    expect(partialRefundAmountCents(input, 10_000)).toBe(expected);
  });

  it.each(['', '0', '-1', '1.001', 'abc', '70.01'])(
    'rejects invalid or excessive value %s',
    (input) => {
      expect(partialRefundAmountCents(input, 7_000)).toBeNull();
    },
  );

  it('renders business-friendly status text', () => {
    expect(humanizeRefundValue('PARTIALLY_REFUNDED')).toBe('Partially refunded');
  });
});
