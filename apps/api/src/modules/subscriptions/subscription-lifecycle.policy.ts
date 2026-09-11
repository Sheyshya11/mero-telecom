import { BadRequestException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';

const allowedTransitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  PENDING: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  ACTIVE: [
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.SUSPENDED,
    SubscriptionStatus.CANCELLATION_PENDING,
  ],
  PAST_DUE: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.SUSPENDED,
    SubscriptionStatus.CANCELLATION_PENDING,
  ],
  CANCELLATION_PENDING: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.DISCONNECTION_PENDING,
  ],
  DISCONNECTION_PENDING: [SubscriptionStatus.CANCELLED],
  SUSPENDED: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLATION_PENDING,
    SubscriptionStatus.TERMINATED,
  ],
  CANCELLED: [],
  TERMINATED: [],
};

export function assertSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): void {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) {
    throw new BadRequestException(
      `Cannot change a ${from.toLowerCase()} subscription to ${to.toLowerCase()}.`,
    );
  }
}
