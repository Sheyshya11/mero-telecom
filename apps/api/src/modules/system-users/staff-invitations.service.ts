import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  Role,
  StaffInvitationStatus,
  UserStatus,
  type StaffInvitation,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { hashPassword, verifyPassword } from '../../common/security/password';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { hasAnyRole, type AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from '../notifications/notification.service';
import type { CreateStaffInvitationDto, StaffInvitationQueryDto } from './dto/system-user.dto';
import type {
  AuditRequestContext,
  PaginatedResponse,
  StaffInvitationResponse,
} from './system-users.types';
import { SystemUserPolicyService } from './system-user-policy.service';

type Transaction = Prisma.TransactionClient;
type IssuedInvitation = StaffInvitation & { token: string; displayName: string };

@Injectable()
export class StaffInvitationsService {
  private readonly logger = new Logger(StaffInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly notifications: NotificationService,
    private readonly policy: SystemUserPolicyService,
  ) {}

  async create(
    input: CreateStaffInvitationDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ): Promise<StaffInvitationResponse> {
    this.policy.assertCanInvite(actor, input.role);
    const email = this.normalizeEmail(input.email);
    const displayName = input.displayName.trim();

    try {
      const issued = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.user.findUnique({
          where: { email },
          include: { customer: { select: { id: true } }, roles: { select: { role: true } } },
        });
        if (existing && this.roleValues(existing).includes(input.role)) {
          throw new ConflictException('This account already has the requested role.');
        }
        if (existing && existing.status !== UserStatus.ACTIVE) {
          throw new ConflictException(
            'This existing account is not eligible for a role invitation.',
          );
        }
        const user =
          existing ??
          (await transaction.user.create({
            data: {
              email,
              displayName,
              roles: { create: { role: input.role, assignedBy: actor.id } },
              passwordHash: null,
              status: UserStatus.INVITATION_PENDING,
              isActive: false,
            },
          }));
        return this.issueWithinTransaction(transaction, {
          email,
          displayName,
          role: input.role,
          invitedById: actor.id,
          action:
            input.role === Role.SUPER_ADMIN
              ? 'SUPER_ADMIN_INVITATION_CREATED'
              : input.role === Role.ADMIN
                ? 'ADMIN_INVITATION_CREATED'
                : 'STAFF_INVITATION_CREATED',
          targetUserId: user.id,
          context: {
            ...context,
            enhancedVerificationSatisfied: input.role === Role.SUPER_ADMIN,
          } as AuditRequestContext,
        });
      });
      await this.queueDelivery(issued);
      return this.toResponse(issued);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (this.isUniqueError(error)) {
        throw new ConflictException(
          'An active invitation or account already exists for this email.',
        );
      }
      throw error;
    }
  }

  async list(
    query: StaffInvitationQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<StaffInvitationResponse>> {
    this.policy.assertCanReadUsers(actor);
    await this.prisma.staffInvitation.updateMany({
      where: {
        status: StaffInvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: StaffInvitationStatus.EXPIRED },
    });
    const where: Prisma.StaffInvitationWhereInput = {
      status: query.status,
      role:
        hasAnyRole(actor, [Role.ADMIN]) && !hasAnyRole(actor, [Role.SUPER_ADMIN])
          ? Role.STAFF
          : query.role,
    };
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.staffInvitation.findMany({
        where,
        include: {
          invitedBy: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.prisma.staffInvitation.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async resend(
    invitationId: string,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ): Promise<StaffInvitationResponse> {
    const issued = await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.staffInvitation.findUnique({
        where: { id: invitationId },
      });
      if (!invitation) throw new NotFoundException('Invitation not found.');
      this.policy.assertCanInvite(actor, invitation.role);
      if (
        invitation.status === StaffInvitationStatus.ACCEPTED ||
        invitation.status === StaffInvitationStatus.REVOKED
      ) {
        throw new ConflictException('Only pending or expired invitations can be resent.');
      }
      const user = await transaction.user.findUnique({
        where: { email: invitation.email },
        include: { roles: { select: { role: true } } },
      });
      if (!user || !this.canAccept(invitation, user)) {
        throw new ConflictException('The invited account is no longer eligible for activation.');
      }
      await transaction.staffInvitation.update({
        where: { id: invitation.id },
        data: { status: StaffInvitationStatus.REVOKED, revokedAt: new Date() },
      });
      return this.issueWithinTransaction(transaction, {
        email: invitation.email,
        displayName: user.displayName ?? invitation.email,
        role: invitation.role as Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>,
        invitedById: actor.id,
        action:
          invitation.role === Role.SUPER_ADMIN
            ? 'SUPER_ADMIN_INVITATION_RESENT'
            : 'STAFF_INVITATION_RESENT',
        targetUserId: user.id,
        context: { ...context, previousInvitationId: invitation.id } as AuditRequestContext,
      });
    });
    await this.queueDelivery(issued);
    return this.toResponse(issued);
  }

  async revoke(
    invitationId: string,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ): Promise<StaffInvitationResponse> {
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.staffInvitation.findUnique({
        where: { id: invitationId },
      });
      if (!current) throw new NotFoundException('Invitation not found.');
      this.policy.assertCanInvite(actor, current.role);
      if (current.status !== StaffInvitationStatus.PENDING) {
        throw new ConflictException('Only a pending invitation can be revoked.');
      }
      const revokedAt = new Date();
      const updated = await transaction.staffInvitation.update({
        where: { id: current.id },
        data: { status: StaffInvitationStatus.REVOKED, revokedAt },
        include: { invitedBy: { select: { id: true, displayName: true, email: true } } },
      });
      await transaction.user.updateMany({
        where: { email: current.email, status: UserStatus.INVITATION_PENDING },
        data: { status: UserStatus.DEACTIVATED, isActive: false },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'STAFF_INVITATION_REVOKED',
          entityType: 'StaffInvitation',
          entityId: current.id,
          metadata: { email: current.email, role: current.role, ...context },
        },
      });
      return updated;
    });
    return this.toResponse(invitation);
  }

  async verify(token: string): Promise<{ valid: boolean; role?: Role; displayName?: string }> {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!invitation || invitation.status !== StaffInvitationStatus.PENDING) {
      return { valid: false };
    }
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.staffInvitation.updateMany({
        where: { id: invitation.id, status: StaffInvitationStatus.PENDING },
        data: { status: StaffInvitationStatus.EXPIRED },
      });
      return { valid: false };
    }
    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      include: { roles: { select: { role: true } } },
    });
    if (!user || !this.canAccept(invitation, user)) {
      return { valid: false };
    }
    return { valid: true, role: invitation.role, displayName: user.displayName ?? undefined };
  }

  async accept(token: string, password: string, context: AuditRequestContext): Promise<void> {
    const tokenHash = this.hashToken(token);
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.staffInvitation.findUnique({ where: { tokenHash } });
      const now = new Date();
      if (
        !invitation ||
        invitation.status !== StaffInvitationStatus.PENDING ||
        invitation.expiresAt <= now
      ) {
        if (invitation?.status === StaffInvitationStatus.PENDING && invitation.expiresAt <= now) {
          await transaction.staffInvitation.updateMany({
            where: { id: invitation.id, status: StaffInvitationStatus.PENDING },
            data: { status: StaffInvitationStatus.EXPIRED },
          });
        }
        throw new BadRequestException('This invitation link is invalid or has expired.');
      }
      const user = await transaction.user.findUnique({
        where: { email: invitation.email },
        include: { customer: { select: { id: true } }, roles: { select: { role: true } } },
      });
      if (!user || !this.canAccept(invitation, user)) {
        throw new BadRequestException('This invitation link is invalid or has expired.');
      }
      const existingActiveAccount = user.status === UserStatus.ACTIVE;
      if (
        existingActiveAccount &&
        (!user.passwordHash || !(await verifyPassword(password, user.passwordHash)))
      ) {
        throw new BadRequestException('The password does not match the existing account.');
      }
      const claimed = await transaction.staffInvitation.updateMany({
        where: {
          id: invitation.id,
          status: StaffInvitationStatus.PENDING,
          acceptedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          status: StaffInvitationStatus.ACCEPTED,
          acceptedById: user.id,
          acceptedAt: now,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This invitation link has already been used.');
      }
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passwordHash: existingActiveAccount ? undefined : passwordHash,
          isActive: true,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: now,
          roles: this.roleValues(user).includes(invitation.role)
            ? undefined
            : { create: { role: invitation.role, assignedBy: invitation.invitedById } },
        },
      });
      await transaction.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.staffInvitation.updateMany({
        where: {
          email: invitation.email,
          id: { not: invitation.id },
          status: StaffInvitationStatus.PENDING,
        },
        data: { status: StaffInvitationStatus.REVOKED, revokedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          action: existingActiveAccount
            ? invitation.role === Role.SUPER_ADMIN
              ? 'SUPER_ADMIN_ACCESS_RECOVERED'
              : user.customer
                ? 'CUSTOMER_STAFF_ROLE_ACCEPTED'
                : 'ADMIN_ACCESS_RECOVERED'
            : invitation.role === Role.SUPER_ADMIN
              ? 'SUPER_ADMIN_INVITATION_ACCEPTED'
              : 'STAFF_INVITATION_ACCEPTED',
          entityType: 'User',
          entityId: user.id,
          metadata: {
            invitationId: invitation.id,
            role: invitation.role,
            existingAccount: existingActiveAccount,
            ...context,
          },
        },
      });
    });
  }

  async bootstrapSuperAdmin(
    emailInput: string,
    nameInput: string,
  ): Promise<{
    outcome: 'created' | 'promoted' | 'updated' | 'already-configured';
    email: string;
    invitationQueued: boolean;
  }> {
    const email = this.normalizeEmail(emailInput);
    const displayName = nameInput.trim() || 'Mero Telecom Super Administrator';
    const issued = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mero-telecom-super-admin-bootstrap'))`;
      const existing = await transaction.user.findUnique({
        where: { email },
        include: { customer: { select: { id: true } }, roles: { select: { role: true } } },
      });
      if (
        existing &&
        (existing.customer ||
          !this.roleValues(existing).some(
            (role) => role === Role.ADMIN || role === Role.SUPER_ADMIN,
          ))
      ) {
        throw new ConflictException(
          'The bootstrap email conflicts with an existing non-administrator identity. Only the exact matching administrator can be promoted.',
        );
      }
      if (!existing) {
        const activeAdminCount = await transaction.user.count({
          where: {
            roles: { some: { role: Role.SUPER_ADMIN } },
            status: UserStatus.ACTIVE,
            isActive: true,
          },
        });
        if (activeAdminCount > 0) {
          throw new ConflictException(
            'An active super administrator already exists. Invite additional privileged users from the dashboard.',
          );
        }
        const user = await transaction.user.create({
          data: {
            email,
            displayName,
            roles: { create: { role: Role.SUPER_ADMIN } },
            passwordHash: null,
            status: UserStatus.INVITATION_PENDING,
            isActive: false,
          },
        });
        const invitation = await this.issueWithinTransaction(transaction, {
          email,
          displayName,
          role: Role.SUPER_ADMIN,
          action: 'SUPER_ADMIN_BOOTSTRAPPED',
          targetUserId: user.id,
          context: {
            source: 'BOOTSTRAP_COMMAND',
            previousRole: null,
            nextRole: Role.SUPER_ADMIN,
          } as AuditRequestContext,
        });
        return { outcome: 'created' as const, invitation };
      }
      const nameChanged = existing.displayName !== displayName;
      const promoted = !this.roleValues(existing).includes(Role.SUPER_ADMIN);
      if (nameChanged) {
        await transaction.user.update({
          where: { id: existing.id },
          data: { displayName },
        });
      }
      if (promoted) {
        await transaction.user.update({
          where: { id: existing.id },
          data: {
            displayName,
            roles: {
              deleteMany: { role: Role.ADMIN },
              create: { role: Role.SUPER_ADMIN },
            },
          },
        });
        await transaction.refreshSession.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await transaction.staffInvitation.updateMany({
          where: { email, status: StaffInvitationStatus.PENDING },
          data: { status: StaffInvitationStatus.REVOKED, revokedAt: new Date() },
        });
        await transaction.auditLog.create({
          data: {
            action: 'SUPER_ADMIN_BOOTSTRAPPED',
            entityType: 'User',
            entityId: existing.id,
            metadata: {
              source: 'BOOTSTRAP_COMMAND',
              previousRole: Role.ADMIN,
              nextRole: Role.SUPER_ADMIN,
              sessionsRevoked: true,
            },
          },
        });
        if (existing.status === UserStatus.ACTIVE && existing.isActive) {
          return { outcome: 'promoted' as const };
        }
      }
      if (existing.status === UserStatus.ACTIVE && existing.isActive) {
        if (nameChanged) {
          await transaction.auditLog.create({
            data: {
              action: 'SUPER_ADMIN_BOOTSTRAP_UPDATED',
              entityType: 'User',
              entityId: existing.id,
              metadata: { changedFields: ['displayName'], source: 'BOOTSTRAP_COMMAND' },
            },
          });
        }
        return { outcome: nameChanged ? ('updated' as const) : ('already-configured' as const) };
      }
      const pending = await transaction.staffInvitation.findFirst({
        where: {
          email,
          role: Role.SUPER_ADMIN,
          status: StaffInvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
      });
      if (pending) {
        return { outcome: nameChanged ? ('updated' as const) : ('already-configured' as const) };
      }
      await transaction.user.update({
        where: { id: existing.id },
        data: { status: UserStatus.INVITATION_PENDING, isActive: false, passwordHash: null },
      });
      const invitation = await this.issueWithinTransaction(transaction, {
        email,
        displayName,
        role: Role.SUPER_ADMIN,
        action: promoted ? 'SUPER_ADMIN_BOOTSTRAPPED' : 'SUPER_ADMIN_BOOTSTRAP_UPDATED',
        targetUserId: existing.id,
        context: {
          source: 'BOOTSTRAP_COMMAND',
          previousRole: promoted ? Role.ADMIN : Role.SUPER_ADMIN,
          nextRole: Role.SUPER_ADMIN,
        } as AuditRequestContext,
      });
      return { outcome: promoted ? ('promoted' as const) : ('updated' as const), invitation };
    });

    const invitationQueued =
      'invitation' in issued && issued.invitation
        ? await this.queueDelivery(issued.invitation)
        : false;
    return { outcome: issued.outcome, email, invitationQueued };
  }

  /** @deprecated Use bootstrapSuperAdmin. */
  bootstrapAdmin(emailInput: string, nameInput: string) {
    return this.bootstrapSuperAdmin(emailInput, nameInput);
  }

  async recoverSuperAdmin(
    emailInput: string,
  ): Promise<{ email: string; invitationQueued: boolean }> {
    const email = this.normalizeEmail(emailInput);
    const issued = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { email },
        include: { customer: { select: { id: true } }, roles: { select: { role: true } } },
      });
      if (!user || !this.roleValues(user).includes(Role.SUPER_ADMIN) || user.customer) {
        throw new ConflictException('The recovery email does not identify a super administrator.');
      }
      await transaction.staffInvitation.updateMany({
        where: { email, status: StaffInvitationStatus.PENDING },
        data: { status: StaffInvitationStatus.REVOKED, revokedAt: new Date() },
      });
      return this.issueWithinTransaction(transaction, {
        email,
        displayName: user.displayName ?? 'Mero Telecom Super Administrator',
        role: Role.SUPER_ADMIN,
        action: 'SUPER_ADMIN_ACCESS_RECOVERY_INITIATED',
        targetUserId: user.id,
        context: { source: 'RECOVERY_COMMAND' } as AuditRequestContext,
      });
    });
    return { email, invitationQueued: await this.queueDelivery(issued) };
  }

  /** @deprecated Use recoverSuperAdmin. */
  recoverAdmin(emailInput: string) {
    return this.recoverSuperAdmin(emailInput);
  }

  private async issueWithinTransaction(
    transaction: Transaction,
    input: {
      email: string;
      displayName: string;
      role: Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>;
      invitedById?: string;
      action: string;
      targetUserId: string;
      context: AuditRequestContext;
    },
  ): Promise<IssuedInvitation> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow('security').staffInvitationTtlHours * 3_600_000,
    );
    const invitation = await transaction.staffInvitation.create({
      data: {
        email: input.email,
        role: input.role,
        tokenHash: this.hashToken(token),
        expiresAt,
        invitedById: input.invitedById,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: input.invitedById,
        action: input.action,
        entityType: 'User',
        entityId: input.targetUserId,
        metadata: {
          invitationId: invitation.id,
          email: input.email,
          role: input.role,
          expiresAt: invitation.expiresAt.toISOString(),
          ...input.context,
        },
      },
    });
    return { ...invitation, token, displayName: input.displayName };
  }

  private async queueDelivery(invitation: IssuedInvitation): Promise<boolean> {
    const activationUrl = new URL('/staff-invitation', this.config.getOrThrow('app').frontendUrl);
    activationUrl.searchParams.set('token', invitation.token);
    try {
      await this.notifications.sendStaffInvitation({
        displayName: invitation.displayName,
        email: invitation.email,
        role: invitation.role as Extract<Role, 'SUPER_ADMIN' | 'ADMIN' | 'STAFF'>,
        activationUrl: activationUrl.toString(),
        expiresAt: invitation.expiresAt,
        invitationId: invitation.id,
      });
      return true;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'staff_invitation_delivery_failed',
          invitationId: invitation.id,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return false;
    }
  }

  private toResponse(
    invitation: StaffInvitation & {
      invitedBy?: { id: string; displayName: string | null; email: string } | null;
    },
  ): StaffInvitationResponse {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      sentAt: invitation.sentAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      invitedBy: invitation.invitedBy ?? null,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private canAccept(
    invitation: Pick<StaffInvitation, 'invitedById' | 'role'>,
    user: { status: UserStatus; roles?: { role: Role }[]; role?: Role },
  ): boolean {
    const roles = user.roles?.map(({ role }) => role) ?? (user.role ? [user.role] : []);
    return (
      (user.status === UserStatus.INVITATION_PENDING && roles.includes(invitation.role)) ||
      (invitation.invitedById !== null &&
        user.status === UserStatus.ACTIVE &&
        !roles.includes(invitation.role)) ||
      (invitation.invitedById === null &&
        (invitation.role === Role.ADMIN || invitation.role === Role.SUPER_ADMIN) &&
        roles.includes(invitation.role) &&
        user.status === UserStatus.ACTIVE)
    );
  }

  private roleValues(user: { roles?: { role: Role }[]; role?: Role }): Role[] {
    return user.roles?.map(({ role }) => role) ?? (user.role ? [user.role] : []);
  }

  private isUniqueError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
