import type { Role } from '@prisma/client';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: Role[];
  /** Highest internal privilege, retained for compatibility with existing domain policies. */
  role: Role;
  /** Server-validated refresh-session identifier; populated by JwtAuthGuard. */
  sessionId?: string;
  /** Epoch seconds of the last password authentication, carried in trusted JWT claims. */
  authenticatedAt?: number;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  requestId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  roles: Role[];
  type: 'access';
  authTime?: number;
}

export const ROLE_PRECEDENCE: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'STAFF', 'CUSTOMER'];

export function primaryRole(roles: readonly Role[]): Role {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? 'CUSTOMER';
}

export function hasAnyRole(
  user: Pick<AuthenticatedUser, 'roles' | 'role'>,
  roles: readonly Role[],
): boolean {
  return (user.roles ?? [user.role]).some((role) => roles.includes(role));
}

/** Marks a server-selected self-service code path so domain services always enforce ownership. */
export function asCustomerContext(user: AuthenticatedUser): AuthenticatedUser {
  return { ...user, role: 'CUSTOMER' };
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
  authTime?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
