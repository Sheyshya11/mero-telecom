import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { createHash } from 'node:crypto';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../cache/redis.service';
import type { NotificationService } from '../notifications/notification.service';
import { FORGOT_PASSWORD_RESPONSE, PasswordResetService } from './password-reset.service';

const user = {
  id: '2cfc1341-2c15-4c54-9fb0-f4012af919fc',
  email: 'customer@example.com',
  displayName: 'Test Customer',
  passwordHash: 'existing-hash',
  role: 'CUSTOMER' as const,
  status: UserStatus.ACTIVE,
  isActive: true,
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  customer: null,
};

function createHarness() {
  const audits: unknown[] = [];
  const passwordResetToken = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: '663f94aa-daf7-4e3c-a63f-b84e5470e980',
        ...data,
        createdAt: new Date(),
        usedAt: null,
        revokedAt: null,
      }),
    ),
    findUnique: jest.fn(),
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    passwordResetToken,
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    auditLog: {
      create: jest.fn().mockImplementation(({ data }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
      createMany: jest.fn().mockImplementation(({ data }) => {
        audits.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest
      .fn()
      .mockImplementation((operation) =>
        Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
      ),
  };
  const redis = {
    incrementWithExpiry: jest
      .fn()
      .mockResolvedValue({ available: true, count: 1, ttlSeconds: 900 }),
  };
  const notifications = {
    sendPasswordReset: jest.fn().mockResolvedValue({}),
    sendPasswordChanged: jest.fn().mockResolvedValue({}),
  };
  const config = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'app') return { frontendUrl: 'http://localhost:3000' };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    notifications as unknown as NotificationService,
    config as never,
  );
  return { audits, notifications, passwordResetToken, prisma, redis, service };
}

describe('PasswordResetService', () => {
  it('returns the same response for known and unknown accounts', async () => {
    const known = createHarness();
    await expect(known.service.request(user.email, {})).resolves.toBe(FORGOT_PASSWORD_RESPONSE);

    const unknown = createHarness();
    unknown.prisma.user.findUnique.mockResolvedValue(null);
    await expect(unknown.service.request('missing@example.com', {})).resolves.toBe(
      FORGOT_PASSWORD_RESPONSE,
    );
  });

  it('stores only a SHA-256 token hash and queues the raw token only inside the reset URL', async () => {
    const { audits, notifications, passwordResetToken, service } = createHarness();
    await service.request(' CUSTOMER@example.com ', { requestId: 'request-1' });

    const storedHash = passwordResetToken.create.mock.calls[0][0].data.tokenHash as string;
    const resetUrl = notifications.sendPasswordReset.mock.calls[0][0].resetUrl as string;
    const rawToken = new URL(resetUrl).searchParams.get('token');
    expect(rawToken).toHaveLength(43);
    expect(storedHash).toBe(
      createHash('sha256')
        .update(rawToken ?? '', 'utf8')
        .digest('hex'),
    );
    expect(storedHash).not.toContain(rawToken);
    expect(JSON.stringify(audits)).not.toContain(rawToken);
    expect(passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id, usedAt: null, revokedAt: null } }),
    );
  });

  it('uses a case-insensitive email rate-limit key and rejects excessive requests', async () => {
    const first = createHarness();
    await first.service.request('CUSTOMER@example.com', { ipAddress: '127.0.0.1' });
    const firstEmailKey = first.redis.incrementWithExpiry.mock.calls[0][0];

    const second = createHarness();
    second.redis.incrementWithExpiry
      .mockResolvedValueOnce({ available: true, count: 4, ttlSeconds: 100 })
      .mockResolvedValueOnce({ available: true, count: 1, ttlSeconds: 100 });
    await expect(
      second.service.request('customer@example.com', { ipAddress: '127.0.0.1' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(second.redis.incrementWithExpiry.mock.calls[0][0]).toBe(firstEmailKey);
  });

  it('fails closed if Redis cannot enforce the reset rate limit', async () => {
    const { redis, service } = createHarness();
    redis.incrementWithExpiry.mockResolvedValue({ available: false, count: 0, ttlSeconds: 0 });
    await expect(service.request(user.email, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('changes only the password, consumes the token, and revokes all refresh sessions', async () => {
    const { notifications, passwordResetToken, prisma, service } = createHarness();
    passwordResetToken.findUnique.mockResolvedValue({
      id: '663f94aa-daf7-4e3c-a63f-b84e5470e980',
      userId: user.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      user,
    });

    await service.reset('r'.repeat(43), 'NewStrongPassword1!', {});

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { passwordHash: expect.any(String) },
    });
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(notifications.sendPasswordChanged).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
    );
  });

  it('rejects an expired or already-used token without changing the password', async () => {
    const { passwordResetToken, prisma, service } = createHarness();
    passwordResetToken.findUnique.mockResolvedValue({
      id: '663f94aa-daf7-4e3c-a63f-b84e5470e980',
      userId: user.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      user,
    });

    await expect(service.reset('r'.repeat(43), 'NewStrongPassword1!', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown token without changing any account', async () => {
    const { passwordResetToken, prisma, service } = createHarness();
    passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(service.reset('w'.repeat(43), 'NewStrongPassword1!', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a used token without changing the password again', async () => {
    const { passwordResetToken, prisma, service } = createHarness();
    passwordResetToken.findUnique.mockResolvedValue({
      id: '663f94aa-daf7-4e3c-a63f-b84e5470e980',
      userId: user.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
      user,
    });

    await expect(service.reset('u'.repeat(43), 'NewStrongPassword1!', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows a suspended account to reset without changing its status or role', async () => {
    const { passwordResetToken, prisma, service } = createHarness();
    passwordResetToken.findUnique.mockResolvedValue({
      id: '663f94aa-daf7-4e3c-a63f-b84e5470e980',
      userId: user.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      user: { ...user, status: UserStatus.SUSPENDED, isActive: false },
    });

    await service.reset('r'.repeat(43), 'NewStrongPassword1!', {});
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      passwordHash: expect.any(String),
    });
  });
});
