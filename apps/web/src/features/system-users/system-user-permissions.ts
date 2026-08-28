import type { SystemRole, SystemUser } from './system-users.types';

export function invitationRolesFor(
  actorRole: SystemRole,
): Array<Extract<SystemRole, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>> {
  if (actorRole === 'SUPER_ADMIN') return ['STAFF', 'ADMIN', 'SUPER_ADMIN'];
  if (actorRole === 'ADMIN') return ['STAFF'];
  return [];
}

export function canChangeTargetStatus(
  actor: { id: string; role: SystemRole },
  target: SystemUser,
): boolean {
  if (target.isCustomer || target.id === actor.id || target.status === 'INVITATION_PENDING') {
    return false;
  }
  if (actor.role === 'SUPER_ADMIN') return true;
  return actor.role === 'ADMIN' && target.role === 'STAFF';
}

export function canControlInvitation(
  actorRole: SystemRole,
  invitationRole: Extract<SystemRole, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>,
): boolean {
  return actorRole === 'SUPER_ADMIN' || (actorRole === 'ADMIN' && invitationRole === 'STAFF');
}
