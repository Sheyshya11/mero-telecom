import { BadRequestException } from '@nestjs/common';
import { AccountInvitationReason, AccountInvitationStatus, UserStatus } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { AccountInvitationsService } from './account-invitations.service';

function createService(prisma: Partial<PrismaService>) {
  const notifications = { sendAccountInvitation: jest.fn().mockResolvedValue({ messageId: 'id' }) };
  const config = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'security') return { accountInvitationTtlHours: 24 };
      if (key === 'app') return { frontendUrl: 'http://localhost:3000' };
      if (key === 'email') return { developmentRecipient: 'developer@example.com' };
      throw new Error(`Unexpected key: ${key}`);
    }),
  };
  return {
    notifications,
    service: new AccountInvitationsService(
      prisma as PrismaService,
      notifications as never,
      config as never,
    ),
  };
}

describe('AccountInvitationsService', () => {
  it('stores only a token hash and revokes previous pending invitations', async () => {
    const transaction = {
      accountInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'invitation-id', expiresAt: data.expiresAt }),
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const { service } = createService({});

    const issued = await service.issueWithinTransaction(transaction as never, {
      userId: 'user-id',
      reason: AccountInvitationReason.ADMIN_CREATED,
      createdByUserId: 'admin-id',
    });

    expect(transaction.accountInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AccountInvitationStatus.REVOKED } }),
    );
    const storedHash = transaction.accountInvitation.create.mock.calls[0][0].data.tokenHash;
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toBe(issued.token);
    expect(issued.token).toHaveLength(43);
  });

  it('activates a pending customer exactly once and never stores the submitted password', async () => {
    const invitation = {
      id: 'invitation-id',
      userId: 'user-id',
      status: AccountInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-id',
        status: UserStatus.INVITATION_PENDING,
        customer: { id: 'customer-id' },
      },
    };
    const transaction = {
      accountInvitation: {
        findUnique: jest.fn().mockResolvedValue(invitation),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      customer: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((operation) => operation(transaction)) };
    const { service } = createService(prisma as never);

    await service.activate('a'.repeat(43), 'StrongPassword1!');

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: expect.objectContaining({
        passwordHash: expect.stringMatching(/^\$2/),
        status: UserStatus.ACTIVE,
        isActive: true,
        emailVerifiedAt: expect.any(Date),
      }),
    });
    expect(JSON.stringify(transaction.user.update.mock.calls)).not.toContain('StrongPassword1!');
    expect(transaction.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
  });

  it('rejects an expired token and marks it expired', async () => {
    const prisma = {
      accountInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invitation-id',
          status: AccountInvitationStatus.PENDING,
          expiresAt: new Date(Date.now() - 1_000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = createService(prisma as never);

    await expect(service.verify('a'.repeat(43))).resolves.toEqual({ valid: false });
    expect(prisma.accountInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: AccountInvitationStatus.EXPIRED } }),
    );
  });

  it('rejects a previously accepted token', async () => {
    const transaction = {
      accountInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invitation-id',
          status: AccountInvitationStatus.ACCEPTED,
          expiresAt: new Date(Date.now() + 60_000),
          user: { status: UserStatus.ACTIVE, customer: { id: 'customer-id' } },
        }),
      },
    };
    const prisma = { $transaction: jest.fn((operation) => operation(transaction)) };
    const { service } = createService(prisma as never);

    await expect(service.activate('a'.repeat(43), 'StrongPassword1!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
