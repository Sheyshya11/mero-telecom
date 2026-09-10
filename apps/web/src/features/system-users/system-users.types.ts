export type SystemRole = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'CUSTOMER';
export type UserStatus = 'INVITATION_PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type StaffInvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface SystemUser {
  id: string;
  displayName: string | null;
  email: string;
  roles: SystemRole[];
  role: SystemRole;
  status: UserStatus;
  isActive: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  isCustomer: boolean;
}

export interface StaffInvitation {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';
  status: StaffInvitationStatus;
  expiresAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  invitedBy: { id: string; displayName: string | null; email: string } | null;
}

export interface SecurityAuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  actor: {
    id: string;
    displayName: string | null;
    email: string;
    roles: Array<{ role: SystemRole }>;
  } | null;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    activeSuperAdminCount?: number;
  };
}
