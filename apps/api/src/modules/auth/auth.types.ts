import type { Role } from '@prisma/client';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  /** Epoch seconds of the last password authentication, carried in trusted JWT claims. */
  authenticatedAt?: number;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  requestId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
  authTime?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  type: 'refresh';
  authTime?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
