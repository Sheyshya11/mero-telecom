import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountInvitationReason,
  AccountInvitationStatus,
  CustomerStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { hashPassword } from '../../common/security/password';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';

type InvitationClient = Prisma.TransactionClient;

export interface IssuedAccountInvitation {
  invitationId: string;
  userId: string;
  token: string;
  expiresAt: Date;
  reason: AccountInvitationReason;
}

@Injectable()
export class AccountInvitationsService {
  private readonly logger = new Logger(AccountInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async issueWithinTransaction(
    transaction: InvitationClient,
    input: {
      userId: string;
      reason: AccountInvitationReason;
      createdByUserId?: string;
      checkoutApplicationId?: string;
    },
  ): Promise<IssuedAccountInvitation> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow('security').accountInvitationTtlHours * 60 * 60 * 1000,
    );

    await transaction.accountInvitation.updateMany({
      where: { userId: input.userId, status: AccountInvitationStatus.PENDING },
      data: { status: AccountInvitationStatus.REVOKED },
    });

    const invitation = await transaction.accountInvitation.create({
      data: {
        userId: input.userId,
        tokenHash: this.hashToken(token),
        reason: input.reason,
        createdByUserId: input.createdByUserId,
        checkoutApplicationId: input.checkoutApplicationId,
        expiresAt,
      },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: input.createdByUserId,
        action:
          input.reason === AccountInvitationReason.RESEND
            ? 'ACCOUNT_INVITATION_RESENT'
            : 'ACCOUNT_INVITATION_CREATED',
        entityType: 'User',
        entityId: input.userId,
        metadata: {
          invitationId: invitation.id,
          reason: input.reason,
          expiresAt: invitation.expiresAt.toISOString(),
        },
      },
    });

    return {
      invitationId: invitation.id,
      userId: input.userId,
      token,
      expiresAt: invitation.expiresAt,
      reason: input.reason,
    };
  }

  async issueAndQueue(input: {
    userId: string;
    reason: AccountInvitationReason;
    createdByUserId?: string;
    checkoutApplicationId?: string;
  }): Promise<{ queued: boolean }> {
    const issued = await this.prisma.$transaction((transaction) =>
      this.issueWithinTransaction(transaction, input),
    );
    return { queued: await this.queueDelivery(issued) };
  }

  async queueDelivery(issued: IssuedAccountInvitation): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: issued.userId },
      include: { customer: true },
    });
    if (!user?.customer) {
      this.logger.error(
        JSON.stringify({
          event: 'account_invitation_delivery_skipped',
          invitationId: issued.invitationId,
          reason: 'customer_profile_missing',
        }),
      );
      return false;
    }

    const activationUrl = new URL('/activate', this.configService.getOrThrow('app').frontendUrl);
    activationUrl.searchParams.set('token', issued.token);

    try {
      await this.notifications.sendAccountInvitation({
        customerName: `${user.customer.firstName} ${user.customer.lastName}`,
        customerEmail: user.email,
        activationUrl: activationUrl.toString(),
        expiresAt: issued.expiresAt,
        reason: issued.reason,
        invitationId: issued.invitationId,
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'account_invitation_delivery_failed',
          invitationId: issued.invitationId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return false;
    }
  }

  async resendByEmail(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(email) },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.role !== Role.CUSTOMER || user.status !== UserStatus.INVITATION_PENDING) {
      return;
    }

    await this.issueAndQueue({ userId: user.id, reason: AccountInvitationReason.RESEND });
  }

  async verify(token: string): Promise<{ valid: boolean }> {
    const invitation = await this.prisma.accountInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!invitation || invitation.status !== AccountInvitationStatus.PENDING) {
      return { valid: false };
    }
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.accountInvitation.updateMany({
        where: { id: invitation.id, status: AccountInvitationStatus.PENDING },
        data: { status: AccountInvitationStatus.EXPIRED },
      });
      return { valid: false };
    }
    return { valid: true };
  }

  async activate(token: string, password: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.accountInvitation.findUnique({
        where: { tokenHash },
        include: { user: { include: { customer: true } } },
      });
      if (
        !invitation ||
        invitation.status !== AccountInvitationStatus.PENDING ||
        invitation.expiresAt <= new Date() ||
        invitation.user.status !== UserStatus.INVITATION_PENDING ||
        !invitation.user.customer
      ) {
        if (
          invitation?.status === AccountInvitationStatus.PENDING &&
          invitation.expiresAt <= new Date()
        ) {
          await transaction.accountInvitation.updateMany({
            where: { id: invitation.id, status: AccountInvitationStatus.PENDING },
            data: { status: AccountInvitationStatus.EXPIRED },
          });
        }
        throw new BadRequestException('This activation link is invalid or has expired.');
      }

      const acceptedAt = new Date();
      const claimed = await transaction.accountInvitation.updateMany({
        where: {
          id: invitation.id,
          status: AccountInvitationStatus.PENDING,
          acceptedAt: null,
          expiresAt: { gt: acceptedAt },
        },
        data: { status: AccountInvitationStatus.ACCEPTED, acceptedAt },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This activation link has already been used.');
      }

      await transaction.user.update({
        where: { id: invitation.userId },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
          isActive: true,
          emailVerifiedAt: acceptedAt,
        },
      });
      await transaction.customer.update({
        where: { id: invitation.user.customer.id },
        data: { status: CustomerStatus.ACTIVE },
      });
      await transaction.accountInvitation.updateMany({
        where: {
          userId: invitation.userId,
          id: { not: invitation.id },
          status: AccountInvitationStatus.PENDING,
        },
        data: { status: AccountInvitationStatus.REVOKED },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: invitation.userId,
          action: 'CUSTOMER_ACCOUNT_ACTIVATED',
          entityType: 'Customer',
          entityId: invitation.user.customer.id,
          metadata: { invitationId: invitation.id },
        },
      });
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
