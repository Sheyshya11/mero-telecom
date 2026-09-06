import { apiRequest } from '../../lib/api/client';
import type {
  Paginated,
  SecurityAuditLog,
  StaffInvitation,
  SystemRole,
  SystemUser,
  UserStatus,
} from './system-users.types';

export function listSystemUsers(
  accessToken: string,
  filters: string | { search?: string; role?: string; status?: string },
) {
  const query = new URLSearchParams(
    typeof filters === 'string'
      ? filters
      : Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return apiRequest<Paginated<SystemUser>>(`/admin/users?${query}`, {}, accessToken);
}

export function listStaffInvitations(accessToken: string, page = 1, limit = 20) {
  return apiRequest<Paginated<StaffInvitation>>(
    `/admin/users/invitations?page=${page}&limit=${limit}`,
    {},
    accessToken,
  );
}

export function inviteSystemUser(
  accessToken: string,
  input: { displayName: string; email: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' },
) {
  return apiRequest<StaffInvitation>(
    '/admin/users/invitations',
    { method: 'POST', body: JSON.stringify(input) },
    accessToken,
  );
}

export function resendSystemInvitation(accessToken: string, invitationId: string) {
  return apiRequest<StaffInvitation>(
    `/admin/users/invitations/${invitationId}/resend`,
    { method: 'POST' },
    accessToken,
  );
}

export function revokeSystemInvitation(accessToken: string, invitationId: string) {
  return apiRequest<StaffInvitation>(
    `/admin/users/invitations/${invitationId}/revoke`,
    { method: 'POST' },
    accessToken,
  );
}

export function changeSystemUserRole(
  accessToken: string,
  userId: string,
  role: Extract<SystemRole, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>,
) {
  return apiRequest<SystemUser>(
    `/admin/users/${userId}/role`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
    accessToken,
  );
}

export function listSecurityAuditLogs(accessToken: string, query = '') {
  return apiRequest<Paginated<SecurityAuditLog>>(`/admin/audit-logs?${query}`, {}, accessToken);
}

export function changeSystemUserStatus(
  accessToken: string,
  userId: string,
  status: Extract<UserStatus, 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>,
) {
  return apiRequest<SystemUser>(
    `/admin/users/${userId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    accessToken,
  );
}
