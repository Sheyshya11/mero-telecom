import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';

import { hashPassword, verifyPassword } from '../../common/security/password';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import type { AuthenticatedUser } from './auth.types';
import type { ChangePasswordDto } from './dto/change-password.dto';

export interface ChangePasswordRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

type ChangePasswordResult =
  | { outcome: 'incorrect-current-password' }
  | { outcome: 'same-password' }
  | { outcome: 'user-unavailable' }
  | {
      outcome: 'changed';
      auditEventId: string;
      displayName: string;
      email: string;
      userId: string;
    };

@Injectable()
export class ChangePasswordService {
  private readonly logger = new Logger(ChangePasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async changePassword(
    actor: AuthenticatedUser,
    input: ChangePasswordDto,
    context: ChangePasswordRequestContext,
  ): Promise<{ success: true; message: string }> {
    if (!actor.sessionId) {
      throw new UnauthorizedException('Authenticated session is unavailable.');
    }
    if (input.newPassword !== input.confirmPassword) {
      throw new BadRequestException('Password confirmation must match.');
    }

    const newPasswordHash = await hashPassword(input.newPassword);
    const result = await this.prisma.$transaction(
      async (transaction): Promise<ChangePasswordResult> => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;
        const user = await transaction.user.findUnique({
          where: { id: actor.id },
          include: { roles: { select: { role: true } } },
        });

        if (!user || !user.isActive || user.status !== UserStatus.ACTIVE || !user.passwordHash) {
          return { outcome: 'user-unavailable' };
        }

        const auditMetadata = {
          actorType: 'SELF_SERVICE',
          actorRoles: user.roles.map(({ role }) => role),
          ...this.auditContext(context),
        } satisfies Prisma.InputJsonObject;

        if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
          await transaction.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'PASSWORD_CHANGE_FAILED',
              entityType: 'User',
              entityId: user.id,
              metadata: { ...auditMetadata, reason: 'incorrect_current_password' },
            },
          });
          return { outcome: 'incorrect-current-password' };
        }

        if (input.newPassword === input.currentPassword) {
          await transaction.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'PASSWORD_CHANGE_FAILED',
              entityType: 'User',
              entityId: user.id,
              metadata: { ...auditMetadata, reason: 'password_reuse' },
            },
          });
          return { outcome: 'same-password' };
        }

        const now = new Date();
        await transaction.user.update({
          where: { id: user.id },
          data: { passwordHash: newPasswordHash },
        });
        const revokedSessions = await transaction.refreshSession.updateMany({
          where: {
            userId: user.id,
            id: { not: actor.sessionId },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        const revokedResetTokens = await transaction.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        const auditEvent = await transaction.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'PASSWORD_CHANGED',
            entityType: 'User',
            entityId: user.id,
            metadata: {
              ...auditMetadata,
              currentSessionRetained: true,
              sessionsRevoked: revokedSessions.count,
              passwordResetTokensRevoked: revokedResetTokens.count,
            },
          },
        });

        return {
          outcome: 'changed',
          auditEventId: auditEvent.id,
          displayName: user.displayName ?? 'customer',
          email: user.email,
          userId: user.id,
        };
      },
      // The per-user advisory lock serializes password mutations. READ COMMITTED ensures a
      // request that waited on that lock observes the preceding password update instead of
      // failing with a stale serializable snapshot.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (result.outcome === 'incorrect-current-password') {
      throw new BadRequestException('Current password is incorrect.');
    }
    if (result.outcome === 'same-password') {
      throw new BadRequestException('New password must be different from the current password.');
    }
    if (result.outcome === 'user-unavailable') {
      throw new UnauthorizedException('User account is unavailable.');
    }

    try {
      await this.notifications.sendPasswordChanged({
        displayName: result.displayName,
        email: result.email,
        userId: result.userId,
        eventId: result.auditEventId,
        currentSessionRetained: true,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'password_changed_notification_queue_failed',
          userId: result.userId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      try {
        await this.prisma.auditLog.create({
          data: {
            actorUserId: result.userId,
            action: 'PASSWORD_CHANGED_NOTIFICATION_FAILED',
            entityType: 'User',
            entityId: result.userId,
            metadata: this.auditContext(context),
          },
        });
      } catch (auditError: unknown) {
        this.logger.error(
          JSON.stringify({
            event: 'password_changed_notification_failure_audit_failed',
            userId: result.userId,
            error: auditError instanceof Error ? auditError.name : 'UnknownError',
          }),
        );
      }
    }

    return { success: true, message: 'Password changed successfully.' };
  }

  private auditContext(context: ChangePasswordRequestContext): Prisma.InputJsonObject {
    return {
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 500) } : {}),
    };
  }
}
