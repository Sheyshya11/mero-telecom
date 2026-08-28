import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { SystemUserPolicyService } from './system-user-policy.service';

const config = { getOrThrow: jest.fn().mockReturnValue({ enhancedAuthMaxAgeSeconds: 600 }) };
const policy = new SystemUserPolicyService(config as never);
const actor = (role: Role, authenticatedAt = Math.floor(Date.now() / 1000)) => ({
  id: `actor-${role}`,
  email: `${role.toLowerCase()}@example.com`,
  role,
  authenticatedAt,
});

describe('SystemUserPolicyService', () => {
  it('allows admins to invite staff only', () => {
    expect(() => policy.assertCanInvite(actor(Role.ADMIN), Role.STAFF)).not.toThrow();
    expect(() => policy.assertCanInvite(actor(Role.ADMIN), Role.ADMIN)).toThrow(ForbiddenException);
    expect(() => policy.assertCanInvite(actor(Role.ADMIN), Role.SUPER_ADMIN)).toThrow(
      ForbiddenException,
    );
  });

  it('allows a recently authenticated super admin to invite privileged roles', () => {
    expect(() => policy.assertCanInvite(actor(Role.SUPER_ADMIN), Role.ADMIN)).not.toThrow();
    expect(() => policy.assertCanInvite(actor(Role.SUPER_ADMIN), Role.SUPER_ADMIN)).not.toThrow();
  });

  it('rejects stale or absent password assurance for super-admin targets', () => {
    expect(() =>
      policy.assertCanInvite(
        actor(Role.SUPER_ADMIN, Math.floor(Date.now() / 1000) - 601),
        Role.SUPER_ADMIN,
      ),
    ).toThrow('Recent password authentication');
    expect(() =>
      policy.assertCanInvite({ ...actor(Role.SUPER_ADMIN), authenticatedAt: 0 }, Role.SUPER_ADMIN),
    ).toThrow(ForbiddenException);
  });

  it('does not permit self-management and reserves security audit history for super admins', () => {
    const superActor = actor(Role.SUPER_ADMIN);
    expect(() => policy.assertCanManageTarget(superActor, superActor, 'status')).toThrow(
      ForbiddenException,
    );
    expect(() => policy.assertCanReadSecurityAudit(actor(Role.ADMIN))).toThrow(ForbiddenException);
    expect(() => policy.assertCanReadSecurityAudit(superActor)).not.toThrow();
  });
});
