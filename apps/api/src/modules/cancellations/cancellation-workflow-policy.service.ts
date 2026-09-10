import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  CancellationProviderStatus,
  CancellationStatus,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';

export interface CancellationPolicyRecord {
  status: CancellationStatus;
  providerStatus: CancellationProviderStatus;
  customer: { userId: string | null };
}

@Injectable()
export class CancellationWorkflowPolicyService {
  assertCanRequestActor(
    subscription: { customer: { userId: string | null } },
    actor: AuthenticatedUser,
  ): void {
    if (actor.role === Role.CUSTOMER) {
      if (subscription.customer.userId !== actor.id) {
        throw new ForbiddenException("You cannot manage another customer's service.");
      }
      return;
    }
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('You do not have permission to request this cancellation.');
    }
  }

  assertCustomerOwns(record: CancellationPolicyRecord, actor: AuthenticatedUser): void {
    if (record.customer.userId !== actor.id) {
      throw new ForbiddenException("You cannot manage another customer's service.");
    }
  }

  assertCanRequest(
    subscription: { status: SubscriptionStatus; customer: { userId: string | null } },
    actor: AuthenticatedUser,
  ): void {
    this.assertCanRequestActor(subscription, actor);
    if (actor.role === Role.CUSTOMER) {
      if (subscription.status !== SubscriptionStatus.ACTIVE) {
        throw new ConflictException('Only an active internet service can be cancelled online.');
      }
      return;
    }
    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.PENDING
    ) {
      throw new ConflictException(
        'This subscription cannot enter cancellation from its current state.',
      );
    }
  }

  assertCanRevoke(record: CancellationPolicyRecord, actor: AuthenticatedUser): void {
    if (actor.role === Role.CUSTOMER) this.assertCustomerOwns(record, actor);
    else if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('You do not have permission to revoke this cancellation.');
    }
    if (
      record.status !== CancellationStatus.SCHEDULED ||
      record.providerStatus !== CancellationProviderStatus.NOT_SUBMITTED
    ) {
      throw new ConflictException(
        'This cancellation is already being processed. Please contact Mero Telecom support.',
      );
    }
  }

  assertCanRetry(record: Pick<CancellationPolicyRecord, 'status'>, actor: AuthenticatedUser): void {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only an administrator can retry a cancellation.');
    }
    if (record.status !== CancellationStatus.FAILED) {
      throw new ConflictException('Only a failed cancellation can be retried.');
    }
  }
}
