import { describe, expect, it } from 'vitest';

import {
  internalRequestStatusLabel,
  internalRequestTypeLabel,
  personLabel,
} from './internal-request.types';

describe('internal request presentation helpers', () => {
  it('uses operational labels for request types and statuses', () => {
    expect(internalRequestTypeLabel('CUSTOMER_ACCOUNT_ACTION')).toBe('Customer Account Action');
    expect(internalRequestStatusLabel('MORE_INFO_REQUIRED')).toBe('Needs Information');
  });

  it('prefers a display name while retaining email as a fallback', () => {
    expect(personLabel({ displayName: 'Alex Admin', email: 'admin@example.test' })).toBe(
      'Alex Admin',
    );
    expect(personLabel({ displayName: null, email: 'staff@example.test' })).toBe(
      'staff@example.test',
    );
  });
});
