import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';

import type { PrismaService } from '../../database/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import type { AuthenticatedUser } from './auth.types';
import { ChangePasswordService } from './change-password.service';

const currentPassword = 'CurrentPassword1!';
const newPassword = 'ReplacementPassword2!';
const actor: AuthenticatedUser = {
  id: '7b2c653c-bbb3-41e2-9bb4-90d88314ce23',
  email: 'account@example.test',
  role: Role.CUSTOMER,
  roles: [Role.CUSTOMER],
  sessionId: '31a12966-c38f-44bd-a436-ef9d59a182ee',
};

async function createHarness() {
  let storedHash = await hash(currentPassword, 4);
  const audits: unknown[] = [];
  const user = {
    id: actor.id,
    email: actor.email,
    displayName: 'Account Owner',
    passwordHash: storedHash,
    isActive: true,
    status: UserStatus.ACTIVE,
    roles: [{ role: Role.CUSTOMER }],
  };
  const transaction = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: {
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...user,
          passwordHash: storedHash,
        }),
      ),
      update: jest.fn().mockImplementation(({ data }) => {
        storedHash = data.passwordHash;
        return Promise.resolve({ ...user, passwordHash: storedHash });
      }),
    },
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: {
      create: jest.fn().mockImplementation(({ data }) => {
        audits.push(data);
        return Promise.resolve({ id: `audit-${audits.length}`, ...data });
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((operation) => operation(transaction)),
    auditLog: {
      create: jest.fn().mockImplementation(({ data }) => {
        audits.push(data);
        return Promise.resolve({ id: `audit-${audits.length}`, ...data });
      }),
    },
  };
  const notifications = { sendPasswordChanged: jest.fn().mockResolvedValue({}) };
  const service = new ChangePasswordService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationService,
  );
  return {
    audits,
    notifications,
    prisma,
    service,
    transaction,
    user,
    getStoredHash: () => storedHash,
  };
}

function input(
  overrides: Partial<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }> = {},
) {
  return {
    currentPassword,
    newPassword,
    confirmPassword: newPassword,
    ...overrides,
  };
}

describe('ChangePasswordService', () => {
  it('hashes the new password, keeps the current session, revokes other sessions, and audits safely', async () => {
    const harness = await createHarness();

    await expect(
      harness.service.changePassword(actor, input(), {
        requestId: 'request-12345678',
        ipAddress: '127.0.0.1',
        userAgent: 'Test browser',
      }),
    ).resolves.toEqual({ success: true, message: 'Password changed successfully.' });

    expect(await compare(newPassword, harness.getStoredHash())).toBe(true);
    expect(await compare(currentPassword, harness.getStoredHash())).toBe(false);
    expect(harness.transaction.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: actor.id, id: { not: actor.sessionId }, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(harness.transaction.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: actor.id, usedAt: null, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(harness.notifications.sendPasswordChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: actor.id,
        eventId: 'audit-1',
        currentSessionRetained: true,
      }),
    );
    const serializedAudits = JSON.stringify(harness.audits);
    expect(serializedAudits).toContain('PASSWORD_CHANGED');
    expect(serializedAudits).not.toContain(currentPassword);
    expect(serializedAudits).not.toContain(newPassword);
    expect(serializedAudits).not.toContain(harness.getStoredHash());
  });

  it('rejects an incorrect current password without updating the password', async () => {
    const harness = await createHarness();

    await expect(
      harness.service.changePassword(actor, input({ currentPassword: 'IncorrectPassword9!' }), {}),
    ).rejects.toThrow('Current password is incorrect.');

    expect(harness.transaction.user.update).not.toHaveBeenCalled();
    expect(harness.notifications.sendPasswordChanged).not.toHaveBeenCalled();
    expect(harness.audits).toContainEqual(
      expect.objectContaining({
        action: 'PASSWORD_CHANGE_FAILED',
        metadata: expect.objectContaining({ reason: 'incorrect_current_password' }),
      }),
    );
  });

  it('rejects confirmation mismatch before reading the account', async () => {
    const harness = await createHarness();
    await expect(
      harness.service.changePassword(actor, input({ confirmPassword: 'DifferentPassword3!' }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects password reuse after verifying the current password', async () => {
    const harness = await createHarness();
    await expect(
      harness.service.changePassword(
        actor,
        input({ newPassword: currentPassword, confirmPassword: currentPassword }),
        {},
      ),
    ).rejects.toThrow('New password must be different from the current password.');
    expect(harness.transaction.user.update).not.toHaveBeenCalled();
    expect(harness.audits).toContainEqual(
      expect.objectContaining({
        action: 'PASSWORD_CHANGE_FAILED',
        metadata: expect.objectContaining({ reason: 'password_reuse' }),
      }),
    );
  });

  it('uses only the authenticated actor ID to select and update the account', async () => {
    const harness = await createHarness();
    await harness.service.changePassword(actor, input(), {});

    expect(harness.transaction.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: actor.id } }),
    );
    expect(harness.transaction.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: actor.id } }),
    );
  });

  it('rejects an unavailable user and a request without a validated session', async () => {
    const missingUser = await createHarness();
    missingUser.transaction.user.findUnique.mockResolvedValue(null);
    await expect(missingUser.service.changePassword(actor, input(), {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const missingSession = await createHarness();
    await expect(
      missingSession.service.changePassword({ ...actor, sessionId: undefined }, input(), {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(missingSession.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not roll back a changed password when notification delivery fails', async () => {
    const harness = await createHarness();
    harness.notifications.sendPasswordChanged.mockRejectedValueOnce(new Error('queue offline'));

    await expect(harness.service.changePassword(actor, input(), {})).resolves.toEqual({
      success: true,
      message: 'Password changed successfully.',
    });

    expect(await compare(newPassword, harness.getStoredHash())).toBe(true);
    expect(harness.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'PASSWORD_CHANGED_NOTIFICATION_FAILED' }),
    });
  });

  it('handles a duplicate old-password request safely after the first change', async () => {
    const harness = await createHarness();
    await harness.service.changePassword(actor, input(), {});

    await expect(harness.service.changePassword(actor, input(), {})).rejects.toThrow(
      'Current password is incorrect.',
    );
    expect(harness.transaction.user.update).toHaveBeenCalledTimes(1);
    expect(harness.notifications.sendPasswordChanged).toHaveBeenCalledTimes(1);
  });
});
