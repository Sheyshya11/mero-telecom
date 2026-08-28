import { Role } from '@prisma/client';

export const systemPermissions = [
  'system-users.read',
  'system-users.manage-staff',
  'system-users.manage-admins',
  'system-users.manage-super-admins',
  'staff-invitations.create',
  'admin-invitations.create',
  'super-admin-invitations.create',
  'security-audit.read',
] as const;

export type SystemPermission = (typeof systemPermissions)[number];

const permissionsByRole: Record<Role, readonly SystemPermission[]> = {
  [Role.SUPER_ADMIN]: systemPermissions,
  [Role.ADMIN]: ['system-users.read', 'system-users.manage-staff', 'staff-invitations.create'],
  [Role.STAFF]: [],
  [Role.CUSTOMER]: [],
};

export function hasSystemPermission(role: Role, permission: SystemPermission): boolean {
  return permissionsByRole[role].includes(permission);
}

/** Explicit route inheritance; it never relies on enum ordering. */
export function roleCanAccessRoute(role: Role, allowedRoles: readonly Role[]): boolean {
  if (allowedRoles.includes(role)) return true;
  return role === Role.SUPER_ADMIN && allowedRoles.includes(Role.ADMIN);
}
