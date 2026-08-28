import { describe, expect, it } from 'vitest';

import {
  canChangeTargetStatus,
  canControlInvitation,
  invitationRolesFor,
} from './system-user-permissions';
import type { SystemUser } from './system-users.types';

const target = (role: SystemUser['role']): SystemUser => ({
  id: `target-${role}`,
  displayName: 'Target',
  email: 'target@example.com',
  role,
  status: 'ACTIVE',
  isActive: true,
  emailVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  isCustomer: role === 'CUSTOMER',
});

describe('system user dashboard permissions', () => {
  it('shows staff-only invitations to admins and all privileged roles to super admins', () => {
    expect(invitationRolesFor('ADMIN')).toEqual(['STAFF']);
    expect(invitationRolesFor('SUPER_ADMIN')).toEqual(['STAFF', 'ADMIN', 'SUPER_ADMIN']);
    expect(invitationRolesFor('STAFF')).toEqual([]);
  });

  it('limits ordinary administrators to staff status controls', () => {
    const admin = { id: 'admin', role: 'ADMIN' as const };
    expect(canChangeTargetStatus(admin, target('STAFF'))).toBe(true);
    expect(canChangeTargetStatus(admin, target('ADMIN'))).toBe(false);
    expect(canChangeTargetStatus(admin, target('SUPER_ADMIN'))).toBe(false);
  });

  it('protects self/customer targets and restricted invitations in the UI', () => {
    const superAdmin = { id: 'target-SUPER_ADMIN', role: 'SUPER_ADMIN' as const };
    expect(canChangeTargetStatus(superAdmin, target('SUPER_ADMIN'))).toBe(false);
    expect(canChangeTargetStatus({ ...superAdmin, id: 'other' }, target('CUSTOMER'))).toBe(false);
    expect(canControlInvitation('ADMIN', 'ADMIN')).toBe(false);
    expect(canControlInvitation('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
  });
});
