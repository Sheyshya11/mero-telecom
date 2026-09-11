import { BadRequestException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';

import { assertSubscriptionTransition } from './subscription-lifecycle.policy';

describe('subscription lifecycle policy', () => {
  it.each([
    [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
    [SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE],
    [SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED],
    [SubscriptionStatus.SUSPENDED, SubscriptionStatus.ACTIVE],
    [SubscriptionStatus.SUSPENDED, SubscriptionStatus.TERMINATED],
  ])('allows %s → %s', (from, to) => {
    expect(() => assertSubscriptionTransition(from, to)).not.toThrow();
  });

  it.each([
    [SubscriptionStatus.ACTIVE, SubscriptionStatus.TERMINATED],
    [SubscriptionStatus.PAST_DUE, SubscriptionStatus.TERMINATED],
    [SubscriptionStatus.TERMINATED, SubscriptionStatus.ACTIVE],
    [SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE],
  ])('rejects %s → %s', (from, to) => {
    expect(() => assertSubscriptionTransition(from, to)).toThrow(BadRequestException);
  });
});
