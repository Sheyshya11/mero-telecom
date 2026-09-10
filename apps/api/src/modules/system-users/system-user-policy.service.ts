import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

import {
  hasSystemPermission,
  type SystemPermission,
} from '../../common/authorization/role-permissions';
import type { AppConfig } from '../../config/configuration';
import { hasAnyRole, type AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class SystemUserPolicyService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  assertCanReadUsers(actor: AuthenticatedUser): void {
    if (
      !(actor.roles ?? [actor.role]).some((role) => hasSystemPermission(role, 'system-users.read'))
    )
      this.deny();
  }

  assertCanReadSecurityAudit(actor: AuthenticatedUser): void {
    if (
      !(actor.roles ?? [actor.role]).some((role) =>
        hasSystemPermission(role, 'security-audit.read'),
      )
    )
      this.deny();
  }

  assertCanInvite(actor: AuthenticatedUser, targetRole: Role): void {
    const permission: SystemPermission | undefined =
      targetRole === Role.STAFF
        ? 'staff-invitations.create'
        : targetRole === Role.ADMIN
          ? 'admin-invitations.create'
          : targetRole === Role.SUPER_ADMIN
            ? 'super-admin-invitations.create'
            : undefined;
    if (
      !permission ||
      !(actor.roles ?? [actor.role]).some((role) => hasSystemPermission(role, permission))
    )
      this.deny();
    if (targetRole === Role.SUPER_ADMIN) this.assertRecentPasswordAuthentication(actor);
  }

  assertCanManageTarget(
    actor: AuthenticatedUser,
    target: { id: string; roles?: { role: Role }[]; role?: Role },
    operation: 'role' | 'status',
    newRole?: Role,
  ): { enhancedVerificationSatisfied: boolean } {
    if (actor.id === target.id) {
      throw new ForbiddenException('You cannot modify your own privileged account.');
    }

    const targetRoles = target.roles?.map(({ role }) => role) ?? (target.role ? [target.role] : []);
    if (hasAnyRole(actor, [Role.ADMIN]) && !hasAnyRole(actor, [Role.SUPER_ADMIN])) {
      if (
        operation === 'status' &&
        targetRoles.includes(Role.STAFF) &&
        !targetRoles.includes(Role.ADMIN)
      ) {
        return { enhancedVerificationSatisfied: false };
      }
      throw new ForbiddenException('Administrators cannot manage administrator accounts or roles.');
    }

    if (!hasAnyRole(actor, [Role.SUPER_ADMIN])) this.deny();
    if (newRole === Role.CUSTOMER) {
      throw new ForbiddenException(
        'Customer identities must be managed through customer administration.',
      );
    }

    const enhanced = targetRoles.includes(Role.SUPER_ADMIN) || newRole === Role.SUPER_ADMIN;
    if (enhanced) this.assertRecentPasswordAuthentication(actor);
    return { enhancedVerificationSatisfied: enhanced };
  }

  private assertRecentPasswordAuthentication(actor: AuthenticatedUser): void {
    const maximumAge = this.config.getOrThrow('security').enhancedAuthMaxAgeSeconds;
    const now = Math.floor(Date.now() / 1000);
    if (!actor.authenticatedAt || now - actor.authenticatedAt > maximumAge) {
      throw new ForbiddenException(
        'Recent password authentication is required. Sign in again before managing a super administrator.',
      );
    }
  }

  private deny(): never {
    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
