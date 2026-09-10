import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';

import { ROLES_KEY } from '../constants/authorization.constants';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types';
import { PrismaService } from '../../database/prisma.service';
import { roleCanAccessRoute } from '../authorization/role-permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (
      (request.user.roles ?? [request.user.role]).some((role) =>
        roleCanAccessRoute(role, allowedRoles),
      )
    ) {
      return true;
    }

    try {
      await this.prisma?.auditLog.create({
        data: {
          actorUserId: request.user.id,
          action: 'PRIVILEGED_ACTION_DENIED',
          entityType: 'HttpRoute',
          entityId: request.originalUrl?.split('?')[0] ?? 'unknown',
          metadata: {
            method: request.method,
            currentRoles: request.user.roles ?? [request.user.role],
            requiredRoles: allowedRoles,
            requestId: request.requestId,
            ipAddress: request.ip,
            userAgent: request.get?.('user-agent')?.slice(0, 500),
          },
        },
      });
    } catch {
      // Authorization must still fail if security-event persistence is temporarily unavailable.
    }

    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
