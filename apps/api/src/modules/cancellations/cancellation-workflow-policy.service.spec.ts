import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  CancellationProviderStatus,
  CancellationStatus,
  Role,
  SubscriptionStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CancellationWorkflowPolicyService } from './cancellation-workflow-policy.service';

const actor = (role: Role, id = `${role.toLowerCase()}-id`): AuthenticatedUser => ({
  id,
  email: `${role.toLowerCase()}@example.test`,
  role,
  roles: [role],
});

describe('CancellationWorkflowPolicyService', () => {
  const policy = new CancellationWorkflowPolicyService();

  it('allows a customer to request cancellation only for their own active service', () => {
    expect(() =>
      policy.assertCanRequest(
        { status: SubscriptionStatus.ACTIVE, customer: { userId: 'customer-id' } },
        actor(Role.CUSTOMER, 'customer-id'),
      ),
    ).not.toThrow();
    expect(() =>
      policy.assertCanRequest(
        { status: SubscriptionStatus.ACTIVE, customer: { userId: 'another-customer' } },
        actor(Role.CUSTOMER, 'customer-id'),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertCanRequest(
        { status: SubscriptionStatus.CANCELLED, customer: { userId: 'customer-id' } },
        actor(Role.CUSTOMER, 'customer-id'),
      ),
    ).toThrow(ConflictException);
  });

  it('allows administrators to withdraw pending activation but denies staff', () => {
    const pending = { status: SubscriptionStatus.PENDING, customer: { userId: null } };
    expect(() => policy.assertCanRequest(pending, actor(Role.ADMIN))).not.toThrow();
    expect(() => policy.assertCanRequest(pending, actor(Role.SUPER_ADMIN))).not.toThrow();
    expect(() => policy.assertCanRequest(pending, actor(Role.STAFF))).toThrow(ForbiddenException);
  });

  it('only revokes a scheduled operation that has not reached the provider', () => {
    const record = {
      status: CancellationStatus.SCHEDULED,
      providerStatus: CancellationProviderStatus.NOT_SUBMITTED,
      customer: { userId: 'customer-id' },
    };
    expect(() => policy.assertCanRevoke(record, actor(Role.CUSTOMER, 'customer-id'))).not.toThrow();
    expect(() =>
      policy.assertCanRevoke(
        { ...record, status: CancellationStatus.DISCONNECTION_PENDING },
        actor(Role.CUSTOMER, 'customer-id'),
      ),
    ).toThrow(ConflictException);
  });

  it('only permits an administrator to retry a failed request', () => {
    expect(() =>
      policy.assertCanRetry({ status: CancellationStatus.FAILED }, actor(Role.ADMIN)),
    ).not.toThrow();
    expect(() =>
      policy.assertCanRetry({ status: CancellationStatus.FAILED }, actor(Role.STAFF)),
    ).toThrow(ForbiddenException);
    expect(() =>
      policy.assertCanRetry({ status: CancellationStatus.SCHEDULED }, actor(Role.ADMIN)),
    ).toThrow(ConflictException);
  });
});
