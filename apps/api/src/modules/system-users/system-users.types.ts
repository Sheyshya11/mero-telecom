import type { Role, StaffInvitationStatus, UserStatus } from '@prisma/client';
import type { Request } from 'express';

export interface AuditRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestedValue?: string;
  reason?: string;
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
  actor: { id: string; displayName: string | null; email: string; role: Role } | null;
}

export function auditContextFromRequest(
  request: Request & { requestId?: string },
): AuditRequestContext {
  return {
    requestId: request.requestId,
    ipAddress: request.ip,
    userAgent: request.get('user-agent')?.slice(0, 500),
  };
}
