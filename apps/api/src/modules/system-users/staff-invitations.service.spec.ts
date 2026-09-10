import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role, StaffInvitationStatus, UserStatus } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { StaffInvitationsService } from './staff-invitations.service';
import { SystemUserPolicyService } from './system-user-policy.service';

function createService(prisma: Record<string, unknown>) {
  const notifications = { sendStaffInvitation: jest.fn().mockResolvedValue({ messageId: 'id' }) };
  const config = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'security')
        return { staffInvitationTtlHours: 48, enhancedAuthMaxAgeSeconds: 600 };
      if (key === 'app') return { frontendUrl: 'http://localhost:3000' };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  return {
    notifications,
    service: new StaffInvitationsService(
      prisma as unknown as PrismaService,
      config as never,
      notifications as never,
      new SystemUserPolicyService(config as never),
    ),
  };
}

const admin = { id: 'admin-id', email: 'admin@example.com', role: Role.ADMIN };
const context = { requestId: 'request-123', ipAddress: '127.0.0.1' };

function pendingInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invitation-id',
    email: 'new.staff@example.com',
    role: Role.STAFF,
    tokenHash: 'a'.repeat(64),
    status: StaffInvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    invitedById: admin.id,
    acceptedById: null,
    acceptedAt: null,
    revokedAt: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('StaffInvitationsService', () => {
  it('allows an administrator to invite staff and stores only a token hash', async () => {
    const transaction = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'staff-id' }),
      },
      staffInvitation: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(
              pendingInvitation({ tokenHash: data.tokenHash, expiresAt: data.expiresAt }),
            ),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);

    const response = await service.create(
      { displayName: 'New Staff', email: 'NEW.STAFF@example.com', role: Role.STAFF },
      admin,
      context,
    );

    const storedHash = transaction.staffInvitation.create.mock.calls[0][0].data.tokenHash;
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(response)).not.toContain(storedHash);
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new.staff@example.com',
          roles: { create: { role: Role.STAFF, assignedBy: admin.id } },
          status: UserStatus.INVITATION_PENDING,
          isActive: false,
        }),
      }),
    );
  });

  it('invites an existing customer to an internal role without creating a duplicate user', async () => {
    const transaction = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer-user',
          email: 'customer@example.com',
          displayName: 'Existing Customer',
          status: UserStatus.ACTIVE,
          roles: [{ role: Role.CUSTOMER }],
          customer: { id: 'customer-profile' },
        }),
        create: jest.fn(),
      },
      staffInvitation: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(pendingInvitation({ ...data, email: 'customer@example.com' })),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);

    await expect(
      service.create(
        { displayName: 'Existing Customer', email: 'customer@example.com', role: Role.STAFF },
        admin,
        context,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ email: 'customer@example.com', role: Role.STAFF }),
    );
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityId: 'customer-user' }) }),
    );
  });

  it('blocks staff from creating privileged invitations', async () => {
    const { service } = createService({});
    await expect(
      service.create(
        { displayName: 'Other', email: 'other@example.com', role: Role.STAFF },
        { ...admin, role: Role.STAFF },
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a valid invitation once, activates the exact invited identity, and audits it', async () => {
    const invitation = pendingInvitation();
    const transaction = {
      staffInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'staff-id',
          email: invitation.email,
          role: Role.STAFF,
          status: UserStatus.INVITATION_PENDING,
          customer: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);

    await service.accept(
      'secure-token-that-is-long-enough-for-testing',
      'StrongPassword1!',
      context,
    );

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'staff-id' },
      data: expect.objectContaining({
        passwordHash: expect.stringMatching(/^\$2/),
        status: UserStatus.ACTIVE,
        isActive: true,
        emailVerifiedAt: expect.any(Date),
      }),
    });
    expect(JSON.stringify(transaction.user.update.mock.calls)).not.toContain('StrongPassword1!');
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'STAFF_INVITATION_ACCEPTED' }),
      }),
    );
  });

  it.each([
    ['expired', pendingInvitation({ expiresAt: new Date(Date.now() - 1_000) })],
    ['revoked', pendingInvitation({ status: StaffInvitationStatus.REVOKED })],
  ])('rejects a %s invitation', async (_label, invitation) => {
    const transaction = {
      staffInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);
    await expect(
      service.accept('secure-token-that-is-long-enough-for-testing', 'StrongPassword1!', context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects acceptance when the invited email no longer resolves to that identity', async () => {
    const transaction = {
      staffInvitation: { findUnique: jest.fn().mockResolvedValue(pendingInvitation()) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);
    await expect(
      service.accept('secure-token-that-is-long-enough-for-testing', 'StrongPassword1!', context),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bootstraps the first super administrator without a password and is idempotent', async () => {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'admin-id' }),
      },
      staffInvitation: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(
              pendingInvitation({ ...data, role: Role.SUPER_ADMIN, email: data.email }),
            ),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);
    const created = await service.bootstrapSuperAdmin('FIRST.ADMIN@example.com', 'First Admin');
    expect(created).toEqual(
      expect.objectContaining({ outcome: 'created', email: 'first.admin@example.com' }),
    );
    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: null,
          roles: { create: { role: Role.SUPER_ADMIN } },
        }),
      }),
    );

    transaction.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      email: 'first.admin@example.com',
      displayName: 'First Admin',
      role: Role.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      isActive: true,
      customer: null,
    });
    const repeated = await service.bootstrapSuperAdmin('first.admin@example.com', 'First Admin');
    expect(repeated.outcome).toBe('already-configured');
    expect(transaction.user.create).toHaveBeenCalledTimes(1);
  });

  it('fails bootstrap safely when the email belongs to another identity', async () => {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer-id',
          role: Role.CUSTOMER,
          customer: { id: 'profile-id' },
        }),
      },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);
    await expect(
      service.bootstrapSuperAdmin('customer@example.com', 'Admin'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('issues audited break-glass recovery only for an existing super administrator', async () => {
    const transaction = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-id',
          email: 'admin@example.com',
          displayName: 'Administrator',
          role: Role.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
          customer: null,
        }),
      },
      staffInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(
              pendingInvitation({ ...data, role: Role.SUPER_ADMIN, invitedById: null }),
            ),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(transaction)) };
    const { service } = createService(prisma);

    await expect(service.recoverSuperAdmin('ADMIN@example.com')).resolves.toEqual({
      email: 'admin@example.com',
      invitationQueued: true,
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SUPER_ADMIN_ACCESS_RECOVERY_INITIATED' }),
      }),
    );
    expect(transaction.user).not.toHaveProperty('update');
  });
});
