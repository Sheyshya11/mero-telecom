import type { Role, StaffInvitationStatus, UserStatus } from '@prisma/client';
import type { Request } from 'express';

export interface AuditRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestedValue?: string;
  reason?: string;
  actorRoles?: Role[];
  sessionId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    activeSuperAdminCount?: number;
  };
}

export interface SystemUserResponse {
  id: string;
  displayName: string | null;
  email: string;
  roles: Role[];
  /** Highest assigned role, kept for existing clients while they migrate to roles. */
  role: Role;
  status: UserStatus;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  isCustomer: boolean;
}

export interface StaffInvitationResponse {
  id: string;
  email: string;
  role: Role;
  status: StaffInvitationStatus;
  expiresAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  invitedBy: { id: string; displayName: string | null; email: string } | null;
}

export interface SecurityAuditResponse {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
  actor: { id: string; displayName: string | null; email: string; roles: { role: Role }[] } | null;
}

export function auditContextFromRequest(
  request: Request & {
    requestId?: string;
    user?: { roles?: Role[]; role?: Role; sessionId?: string };
  },
): AuditRequestContext {
  return {
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.get('user-agent')?.slice(0, 500),
    actorRoles: request.user?.roles ?? (request.user?.role ? [request.user.role] : undefined),
    sessionId: request.user?.sessionId,
  };
}
