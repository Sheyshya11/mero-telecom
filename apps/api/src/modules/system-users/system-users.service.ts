import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ChangeSystemRoleDto,
  ChangeSystemUserStatusDto,
  SecurityAuditQueryDto,
  SystemUserQueryDto,
} from './dto/system-user.dto';
import { SystemUserPolicyService } from './system-user-policy.service';
import type {
  AuditRequestContext,
  PaginatedResponse,
  SecurityAuditResponse,
  SystemUserResponse,
} from './system-users.types';

@Injectable()
export class SystemUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SystemUserPolicyService,
  ) {}

  async list(
    query: SystemUserQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<SystemUserResponse>> {
    this.policy.assertCanReadUsers(actor);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      role: query.role,
      status: query.status,
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { displayName: { contains: search, mode: 'insensitive' as const } },
              { customer: { firstName: { contains: search, mode: 'insensitive' as const } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { customer: { select: { firstName: true, lastName: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return this.paginate(
      users.map((user) => this.toResponse(user)),
      query,
      total,
    );
  }

  async listAuditLogs(
    query: SecurityAuditQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<SecurityAuditResponse>> {
    this.policy.assertCanReadSecurityAudit(actor);
    const where: Prisma.AuditLogWhereInput = {
      action: query.action,
      entityType: query.entityType,
    };
    const skip = (query.page - 1) * query.limit;
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, displayName: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return this.paginate(logs, query, total);
  }

  async changeRole(
    userId: string,
    input: ChangeSystemRoleDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ): Promise<SystemUserResponse> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await this.lockSuperAdministratorChanges(transaction);
          const user = await this.findTarget(transaction, userId);
          const assurance = this.policy.assertCanManageTarget(actor, user, 'role', input.role);
          if (user.customer || user.role === Role.CUSTOMER) {
            throw new ConflictException(
              'Customer identities cannot be converted into system accounts. Use a separate staff invitation.',
            );
          }
          if (user.status === UserStatus.INVITATION_PENDING) {
            throw new ConflictException(
              'Revoke this invitation and create a new one with the intended role.',
            );
          }
          if (user.role === input.role) return this.toResponse(user);
          if (user.role === Role.SUPER_ADMIN) {
            await this.assertAnotherActiveSuperAdmin(transaction, user);
          }

          const updated = await transaction.user.update({
            where: { id: user.id },
            data: { role: input.role },
            include: { customer: { select: { id: true, firstName: true, lastName: true } } },
          });
          await this.revokeSessions(transaction, user.id);
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: this.roleChangeAction(user.role, updated.role),
              entityType: 'User',
              entityId: user.id,
              metadata: {
                previous: { role: user.role },
                next: { role: updated.role },
                sessionsRevoked: true,
                enhancedVerificationSatisfied: assurance.enhancedVerificationSatisfied,
                ...context,
              },
            },
          });
          return this.toResponse(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        await this.recordDenied(actor, userId, 'SYSTEM_ROLE_CHANGE_DENIED', {
          ...context,
          requestedValue: input.role,
          reason: error.message,
        });
      }
      throw error;
    }
  }

  async changeStatus(
    userId: string,
    input: ChangeSystemUserStatusDto,
    actor: AuthenticatedUser,
    context: AuditRequestContext,
  ): Promise<SystemUserResponse> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await this.lockSuperAdministratorChanges(transaction);
          const user = await this.findTarget(transaction, userId);
          const assurance = this.policy.assertCanManageTarget(actor, user, 'status');
          if (user.customer || user.role === Role.CUSTOMER) {
            throw new ConflictException('Customer status is managed from Customer Management.');
          }
          if (user.status === UserStatus.INVITATION_PENDING) {
            throw new ConflictException('Pending accounts are managed through their invitation.');
          }
          if (user.status === input.status) return this.toResponse(user);
          if (user.role === Role.SUPER_ADMIN && input.status !== UserStatus.ACTIVE) {
            await this.assertAnotherActiveSuperAdmin(transaction, user);
          }
          if (input.status === UserStatus.ACTIVE && (!user.passwordHash || !user.emailVerifiedAt)) {
            throw new ConflictException('This account must complete identity verification first.');
          }

          const updated = await transaction.user.update({
            where: { id: user.id },
            data: { status: input.status, isActive: input.status === UserStatus.ACTIVE },
            include: { customer: { select: { id: true, firstName: true, lastName: true } } },
          });
          await this.revokeSessions(transaction, user.id);
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: this.statusChangeAction(user.role, input.status),
              entityType: 'User',
              entityId: user.id,
              metadata: {
                previous: { status: user.status, isActive: user.isActive },
                next: { status: updated.status, isActive: updated.isActive },
                sessionsRevoked: true,
                enhancedVerificationSatisfied: assurance.enhancedVerificationSatisfied,
                ...context,
              },
            },
          });
          return this.toResponse(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ForbiddenException) {
        await this.recordDenied(actor, userId, 'SYSTEM_STATUS_CHANGE_DENIED', {
          ...context,
          requestedValue: input.status,
          reason: error.message,
        });
      }
      throw error;
    }
  }

  private async findTarget(transaction: Prisma.TransactionClient, userId: string) {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private async lockSuperAdministratorChanges(
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mero-telecom-active-super-admin'))`;
  }

  private async assertAnotherActiveSuperAdmin(
    transaction: Prisma.TransactionClient,
    user: { id: string; status: UserStatus; isActive: boolean },
  ): Promise<void> {
    if (user.status !== UserStatus.ACTIVE || !user.isActive) return;
    const remaining = await transaction.user.count({
      where: {
        id: { not: user.id },
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        isActive: true,
      },
    });
    if (remaining < 1) {
      throw new ConflictException('The final active super administrator cannot be changed.');
    }
  }

  private async revokeSessions(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private roleChangeAction(previous: Role, next: Role): string {
    if (next === Role.SUPER_ADMIN) return 'USER_PROMOTED_TO_SUPER_ADMIN';
    if (previous === Role.SUPER_ADMIN) return 'SUPER_ADMIN_DEMOTED';
    if (next === Role.ADMIN) return 'ADMIN_PROMOTED';
    if (previous === Role.ADMIN) return 'ADMIN_DEMOTED';
    return 'SYSTEM_USER_ROLE_CHANGED';
  }

  private statusChangeAction(role: Role, status: UserStatus): string {
    const prefix =
      role === Role.SUPER_ADMIN || role === Role.ADMIN ? 'PRIVILEGED_ACCOUNT' : 'SYSTEM_USER';
    if (status === UserStatus.ACTIVE) return `${prefix}_REACTIVATED`;
    if (status === UserStatus.SUSPENDED) return `${prefix}_SUSPENDED`;
    return `${prefix}_DEACTIVATED`;
  }

  private async recordDenied(
    actor: AuthenticatedUser,
    targetUserId: string,
    action: string,
    context: AuditRequestContext,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action,
        entityType: 'User',
        entityId: targetUserId,
        metadata: { enhancedVerificationSatisfied: false, ...context },
      },
    });
  }

  private paginate<T>(
    data: T[],
    query: { page: number; limit: number },
    total: number,
  ): PaginatedResponse<T> {
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  private toResponse(user: {
    id: string;
    displayName: string | null;
    email: string;
    role: Role;
    status: UserStatus;
    isActive: boolean;
    emailVerifiedAt: Date | null;
    createdAt: Date;
    customer?: { id?: string; firstName: string; lastName: string } | null;
  }): SystemUserResponse {
    return {
      id: user.id,
      displayName:
        user.displayName ??
        (user.customer ? `${user.customer.firstName} ${user.customer.lastName}` : null),
      email: user.email,
      role: user.role,
      status: user.status,
      isActive: user.isActive,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      isCustomer: Boolean(user.customer),
    };
  }
}
