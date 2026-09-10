import { ConflictException, ForbiddenException } from '@nestjs/common';
import { InternalRequestLevel, InternalRequestStatus, Role, SupportStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../../modules/auth/auth.types';
import { TicketWorkflowPolicyService } from './ticket-workflow-policy.service';

describe('TicketWorkflowPolicyService', () => {
  const policy = new TicketWorkflowPolicyService();
  const actor = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@merotelecom.test`,
    role,
    roles: [role],
  });
  const staff = actor('staff-id', Role.STAFF);
  const admin = actor('admin-id', Role.ADMIN);
  const superAdmin = actor('super-id', Role.SUPER_ADMIN);

  it('blocks resolution while Super Admin review is pending or waiting for information', () => {
    const supportCase = {
      assignedToUserId: staff.id,
      status: SupportStatus.IN_PROGRESS,
    };
    for (const status of [
      InternalRequestStatus.PENDING,
      InternalRequestStatus.IN_REVIEW,
      InternalRequestStatus.MORE_INFO_REQUIRED,
    ]) {
      expect(() =>
        policy.assertCanResolveSupport(supportCase, staff, [
          {
            requestNumber: 'IR-2026-00042',
            currentLevel: InternalRequestLevel.SUPER_ADMIN,
            status,
          },
        ]),
      ).toThrow(ConflictException);
    }
  });

  it('keeps an approved request blocking until the operational work is recorded complete', () => {
    const supportCase = {
      assignedToUserId: staff.id,
      status: SupportStatus.IN_PROGRESS,
    };
    const blockers = [
      {
        requestNumber: 'IR-2026-00042',
        currentLevel: InternalRequestLevel.ADMIN,
        status: InternalRequestStatus.APPROVED,
      },
    ];
    const capabilities = policy.supportCaseCapabilities(supportCase, staff, blockers);
    expect(capabilities.canResolve).toBe(false);
    expect(capabilities.resolutionBlockedReason).toContain('approved action');
  });

  it('allows only the assigned owner to resolve a ticket with no unfinished request', () => {
    const supportCase = {
      assignedToUserId: staff.id,
      status: SupportStatus.IN_PROGRESS,
    };
    expect(() => policy.assertCanResolveSupport(supportCase, staff, [])).not.toThrow();
    expect(() => policy.assertCanResolveSupport(supportCase, admin, [])).toThrow(
      ForbiddenException,
    );
  });

  it('derives role, level, assignment, and state-specific internal request capabilities', () => {
    const pendingSuperAdminReview = {
      requestedByUserId: staff.id,
      assignedToUserId: admin.id,
      superAdminAssignedToUserId: superAdmin.id,
      currentLevel: InternalRequestLevel.SUPER_ADMIN,
      status: InternalRequestStatus.IN_REVIEW,
    };
    expect(policy.internalRequestCapabilities(pendingSuperAdminReview, staff).canResolve).toBe(
      false,
    );
    expect(policy.internalRequestCapabilities(pendingSuperAdminReview, admin).canResolve).toBe(
      false,
    );
    expect(policy.internalRequestCapabilities(pendingSuperAdminReview, superAdmin)).toEqual(
      expect.objectContaining({
        canApprove: true,
        canReject: true,
        canRequestInfo: true,
        canResolve: false,
      }),
    );
  });

  it('prevents self-review and role-route impersonation', () => {
    expect(() => policy.assertNotSelfDecision({ requestedByUserId: admin.id }, admin)).toThrow(
      ForbiddenException,
    );
    expect(() => policy.assertAdminActor(superAdmin)).toThrow(ForbiddenException);
    expect(() => policy.assertSuperAdminActor(admin)).toThrow(ForbiddenException);
  });
});
