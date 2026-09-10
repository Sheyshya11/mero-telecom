import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { hashPassword } from '../../common/security/password';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../cache/redis.service';
import { NotificationService } from '../notifications/notification.service';

export const FORGOT_PASSWORD_RESPONSE =
  'If an account exists for that email address, a password reset link has been sent.';

const invalidResetMessage = 'This password reset link is invalid or has expired.';
const resetTokenLifetimeMilliseconds = 30 * 60 * 1000;
const emailRateLimit = { maximum: 3, windowSeconds: 30 * 60 };
const ipRateLimit = { maximum: 5, windowSeconds: 15 * 60 };

export interface PasswordResetRequestContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async request(emailInput: string, context: PasswordResetRequestContext): Promise<string> {
    const email = this.normalizeEmail(emailInput);
    await this.enforceRateLimits(email, context);
    await this.cleanupExpiredTokens();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });

    if (!user || !this.isEligibleStatus(user.status) || !user.passwordHash) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: user?.id,
          action: 'PASSWORD_RESET_REQUEST_FAILED',
          entityType: 'Authentication',
          entityId: user?.id ?? 'unknown',
          metadata: { reason: 'account_not_eligible', ...this.auditContext(context) },
        },
      });
      return FORGOT_PASSWORD_RESPONSE;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + resetTokenLifetimeMilliseconds);
    const token = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
        const current = await transaction.user.findUnique({
          where: { id: user.id },
          select: { status: true, passwordHash: true },
        });
        if (!current || !this.isEligibleStatus(current.status) || !current.passwordHash) {
          await transaction.auditLog.create({
            data: {
              actorUserId: user.id,
              action: 'PASSWORD_RESET_REQUEST_FAILED',
              entityType: 'Authentication',
              entityId: user.id,
              metadata: { reason: 'account_became_ineligible', ...this.auditContext(context) },
            },
          });
          return null;
        }
        await transaction.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const created = await transaction.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(rawToken),
            expiresAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'PASSWORD_RESET_REQUESTED',
            entityType: 'PasswordResetToken',
            entityId: created.id,
            metadata: { expiresAt: expiresAt.toISOString(), ...this.auditContext(context) },
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!token) return FORGOT_PASSWORD_RESPONSE;

    const resetUrl = new URL('/reset-password', this.config.getOrThrow('app').frontendUrl);
    resetUrl.searchParams.set('token', rawToken);
    try {
      await this.notifications.sendPasswordReset({
        displayName:
          user.displayName ??
          (user.customer ? `${user.customer.firstName} ${user.customer.lastName}` : 'customer'),
        email: user.email,
        resetUrl: resetUrl.toString(),
        expiresAt,
        passwordResetTokenId: token.id,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'password_reset_email_queue_failed',
          passwordResetTokenId: token.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      await this.prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PASSWORD_RESET_EMAIL_QUEUE_FAILED',
          entityType: 'PasswordResetToken',
          entityId: token.id,
          metadata: this.auditContext(context),
        },
      });
    }
    return FORGOT_PASSWORD_RESPONSE;
  }

  async validate(rawToken: string): Promise<{ valid: boolean }> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: { select: { status: true, passwordHash: true } } },
    });
    if (!token || token.usedAt || token.revokedAt || !this.isEligibleStatus(token.user.status)) {
      return { valid: false };
    }
    if (token.expiresAt <= new Date()) {
      await this.prisma.$transaction([
        this.prisma.passwordResetToken.updateMany({
          where: { id: token.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.auditLog.create({
          data: {
            actorUserId: token.userId,
            action: 'PASSWORD_RESET_TOKEN_EXPIRED',
            entityType: 'PasswordResetToken',
            entityId: token.id,
          },
        }),
      ]);
      return { valid: false };
    }
    return { valid: Boolean(token.user.passwordHash) };
  }

  async reset(
    rawToken: string,
    newPassword: string,
    context: PasswordResetRequestContext,
  ): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const newPasswordHash = await hashPassword(newPassword);
    const result = await this.prisma.$transaction(
      async (transaction) => {
        let token = await transaction.passwordResetToken.findUnique({
          where: { tokenHash },
          include: { user: { include: { roles: { select: { role: true } } } } },
        });
        if (!token) {
          await this.createFailureAudit(transaction, 'unknown', undefined, context);
          return { completed: false as const };
        }

        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${token.userId}))`;
        token = await transaction.passwordResetToken.findUnique({
          where: { id: token.id },
          include: { user: { include: { roles: { select: { role: true } } } } },
        });
        if (!token) {
          await this.createFailureAudit(transaction, 'unknown', undefined, context);
          return { completed: false as const };
        }

        const now = new Date();
        if (token.expiresAt <= now) {
          await transaction.passwordResetToken.updateMany({
            where: { id: token.id, usedAt: null, revokedAt: null },
            data: { revokedAt: now },
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: token.userId,
              action: 'PASSWORD_RESET_TOKEN_EXPIRED',
              entityType: 'PasswordResetToken',
              entityId: token.id,
              metadata: this.auditContext(context),
            },
          });
          return { completed: false as const };
        }
        if (
          token.usedAt ||
          token.revokedAt ||
          !token.user.passwordHash ||
          !this.isEligibleStatus(token.user.status)
        ) {
          await this.createFailureAudit(transaction, token.id, token.userId, context);
          return { completed: false as const };
        }

        const claimed = await transaction.passwordResetToken.updateMany({
          where: {
            id: token.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) {
          await this.createFailureAudit(transaction, token.id, token.userId, context);
          return { completed: false as const };
        }

        await transaction.user.update({
          where: { id: token.userId },
          data: { passwordHash: newPasswordHash },
        });
        const revokedSessions = await transaction.refreshSession.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.passwordResetToken.updateMany({
          where: {
            userId: token.userId,
            id: { not: token.id },
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await transaction.auditLog.createMany({
          data: [
            {
              actorUserId: token.userId,
              action: 'PASSWORD_RESET_COMPLETED',
              entityType: 'PasswordResetToken',
              entityId: token.id,
              metadata: {
                sessionsRevoked: revokedSessions.count,
                rolesPreserved: token.user.roles?.map(({ role }) => role) ?? [
                  (token.user as unknown as { role: string }).role,
                ],
                statusPreserved: token.user.status,
                ...this.auditContext(context),
              },
            },
            {
              actorUserId: token.userId,
              action: 'PASSWORD_CHANGED',
              entityType: 'User',
              entityId: token.userId,
              metadata: this.auditContext(context),
            },
          ],
        });
        return {
          completed: true as const,
          tokenId: token.id,
          userId: token.userId,
          email: token.user.email,
          displayName: token.user.displayName ?? 'customer',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!result.completed) throw new BadRequestException(invalidResetMessage);

    try {
      await this.notifications.sendPasswordChanged({
        displayName: result.displayName,
        email: result.email,
        userId: result.userId,
        passwordResetTokenId: result.tokenId,
      });
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'password_changed_email_queue_failed',
          passwordResetTokenId: result.tokenId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      await this.prisma.auditLog.create({
        data: {
          actorUserId: result.userId,
          action: 'PASSWORD_CHANGED_EMAIL_QUEUE_FAILED',
          entityType: 'User',
          entityId: result.userId,
          metadata: this.auditContext(context),
        },
      });
    }
  }

  private async enforceRateLimits(
    email: string,
    context: PasswordResetRequestContext,
  ): Promise<void> {
    const emailKey = `mero-telecom:password-reset:email:v1:${this.hashToken(email)}`;
    const ipKey = `mero-telecom:password-reset:ip:v1:${this.hashToken(context.ipAddress ?? 'unknown')}`;
    const [emailResult, ipResult] = await Promise.all([
      this.redis.incrementWithExpiry(emailKey, emailRateLimit.windowSeconds),
      this.redis.incrementWithExpiry(ipKey, ipRateLimit.windowSeconds),
    ]);
    if (!emailResult.available || !ipResult.available) {
      await this.auditRateLimit('unavailable', context);
      throw new ServiceUnavailableException(
        'Password reset is temporarily unavailable. Please try again later.',
      );
    }
    const dimension =
      emailResult.count > emailRateLimit.maximum
        ? 'email'
        : ipResult.count > ipRateLimit.maximum
          ? 'ip'
          : null;
    if (!dimension) return;
    await this.auditRateLimit(dimension, context);
    throw new HttpException(
      'Too many password reset requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async auditRateLimit(
    dimension: 'email' | 'ip' | 'unavailable',
    context: PasswordResetRequestContext,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action:
          dimension === 'unavailable'
            ? 'PASSWORD_RESET_REQUEST_FAILED'
            : 'PASSWORD_RESET_RATE_LIMITED',
        entityType: 'Authentication',
        entityId: 'password-reset',
        metadata: { dimension, ...this.auditContext(context) },
      },
    });
  }

  private createFailureAudit(
    transaction: Prisma.TransactionClient,
    entityId: string,
    actorUserId: string | undefined,
    context: PasswordResetRequestContext,
  ): Promise<unknown> {
    return transaction.auditLog.create({
      data: {
        actorUserId,
        action: 'PASSWORD_RESET_FAILED',
        entityType: entityId === 'unknown' ? 'Authentication' : 'PasswordResetToken',
        entityId,
        metadata: this.auditContext(context),
      },
    });
  }

  private cleanupExpiredTokens(): Promise<Prisma.BatchPayload> {
    return this.prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    });
  }

  private isEligibleStatus(status: UserStatus): boolean {
    return status === UserStatus.ACTIVE || status === UserStatus.SUSPENDED;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private auditContext(context: PasswordResetRequestContext): Prisma.InputJsonObject {
    return {
      actorType: 'SELF_SERVICE',
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent.slice(0, 500) } : {}),
    };
  }
}
