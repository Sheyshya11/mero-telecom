import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { PrismaService } from '../src/database/prisma.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';

const originalPassword = 'OriginalPassword1!';
const newPassword = 'UpdatedPassword2!';
const genericMessage =
  'If an account exists for that email address, a password reset link has been sent.';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the password email worker.');
}

async function clearPasswordResetRateLimits(): Promise<void> {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: 'mero-telecom:password-reset:*',
      COUNT: 100,
    })) {
      if (keys.length > 0) await client.del(keys);
    }
  } finally {
    client.destroy();
  }
}

describe('Password reset API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sendEmail = jest.fn().mockResolvedValue({ messageId: 'password-reset-e2e-message' });

  beforeAll(async () => {
    await clearPasswordResetRateLimits();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailProvider)
      .useValue({ send: sendEmail })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@password-reset.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@password-reset.test' } } });
    await app.close();
  });

  it('does not disclose unknown, invited, or deactivated accounts', async () => {
    const passwordHash = await hash(originalPassword, 12);
    await prisma.user.createMany({
      data: [
        {
          email: 'invited@password-reset.test',
          role: Role.CUSTOMER,
          status: UserStatus.INVITATION_PENDING,
          isActive: false,
        },
        {
          email: 'deactivated@password-reset.test',
          role: Role.STAFF,
          status: UserStatus.DEACTIVATED,
          isActive: false,
          passwordHash,
        },
      ],
    });

    for (const [index, email] of [
      'missing@password-reset.test',
      'invited@password-reset.test',
      'deactivated@password-reset.test',
    ].entries()) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('Origin', 'http://localhost:3000')
        .set('X-Forwarded-For', `10.0.0.${index + 1}`)
        .send({ email })
        .expect(200);
      expect(response.body).toEqual({ message: genericMessage });
    }
    expect(
      await prisma.passwordResetToken.count({
        where: {
          user: {
            email: { in: ['invited@password-reset.test', 'deactivated@password-reset.test'] },
          },
        },
      }),
    ).toBe(0);
  });

  it('queues a secure token, resets once, revokes sessions, and sends a security email', async () => {
    const passwordHash = await hash(originalPassword, 12);
    const customer = await prisma.user.create({
      data: {
        email: 'customer@password-reset.test',
        displayName: 'Reset Customer',
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
        isActive: true,
        passwordHash,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: customer.email, password: originalPassword })
      .expect(200);
    const refreshCookie = (login.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0];
    expect(refreshCookie).toContain('refresh_token=');
    const initialEmailCalls = sendEmail.mock.calls.length;

    const forgot = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', '10.0.1.1')
      .send({ email: ' CUSTOMER@password-reset.test ' })
      .expect(200);
    expect(forgot.body).toEqual({ message: genericMessage });
    await waitUntil(() => sendEmail.mock.calls.length > initialEmailCalls);

    const resetMessage = sendEmail.mock.calls
      .slice(initialEmailCalls)
      .map((call) => call[0] as { subject: string; text: string })
      .find((message) => message.subject === 'Reset your Mero Telecom password');
    expect(resetMessage).toBeDefined();
    const url = resetMessage?.text.split('\n').find((line) => line.startsWith('http')) ?? '';
    const rawToken = new URL(url).searchParams.get('token') ?? '';
    const storedToken = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: customer.id, usedAt: null, revokedAt: null },
    });
    expect(storedToken.tokenHash).toBe(sha256(rawToken));
    expect(storedToken.tokenHash).not.toContain(rawToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: rawToken, newPassword })
      .expect(204);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(updated.role).toBe(Role.CUSTOMER);
    expect(updated.status).toBe(UserStatus.ACTIVE);
    expect(updated.isActive).toBe(true);
    expect(await compare(newPassword, updated.passwordHash ?? '')).toBe(true);
    expect(await compare(originalPassword, updated.passwordHash ?? '')).toBe(false);
    expect(
      await prisma.refreshSession.count({ where: { userId: customer.id, revokedAt: null } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', refreshCookie ?? '')
      .expect(401);
    expect(
      (await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: storedToken.id } })).usedAt,
    ).toBeInstanceOf(Date);
    await waitUntil(() =>
      sendEmail.mock.calls.some(
        (call) =>
          (call[0] as { subject: string }).subject === 'Your Mero Telecom password was changed',
      ),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: rawToken, newPassword: 'AnotherStrongPassword3!' })
      .expect(400);
  });

  it('invalidates token A when token B is requested and accepts only token B', async () => {
    const account = await prisma.user.create({
      data: {
        email: 'newest-token@password-reset.test',
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
        isActive: true,
        passwordHash: await hash(originalPassword, 12),
      },
    });
    const before = sendEmail.mock.calls.length;

    for (const ip of ['10.1.1.1', '10.1.1.2']) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('Origin', 'http://localhost:3000')
        .set('X-Forwarded-For', ip)
        .send({ email: account.email })
        .expect(200);
      await waitUntil(
        () =>
          sendEmail.mock.calls
            .slice(before)
            .filter(
              (call) =>
                (call[0] as { subject: string }).subject === 'Reset your Mero Telecom password',
            ).length >= (ip.endsWith('.1') ? 1 : 2),
      );
    }
    const messages = sendEmail.mock.calls
      .slice(before)
      .map((call) => call[0] as { subject: string; text: string })
      .filter((message) => message.subject === 'Reset your Mero Telecom password');
    const tokens = messages.map((message) => {
      const url = message.text.split('\n').find((line) => line.startsWith('http')) ?? '';
      return new URL(url).searchParams.get('token') ?? '';
    });
    expect(tokens).toHaveLength(2);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: tokens[0], newPassword })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: tokens[1], newPassword })
      .expect(204);
  });

  it.each([
    [Role.SUPER_ADMIN, UserStatus.ACTIVE, true],
    [Role.ADMIN, UserStatus.ACTIVE, true],
    [Role.STAFF, UserStatus.ACTIVE, true],
    [Role.CUSTOMER, UserStatus.SUSPENDED, false],
  ])('preserves %s role and %s status', async (role, status, isActive) => {
    const email = `${role.toLowerCase()}-${status.toLowerCase()}@password-reset.test`;
    const account = await prisma.user.create({
      data: {
        email,
        role,
        status,
        isActive,
        passwordHash: await hash(originalPassword, 12),
      },
    });
    const rawToken = `${role}-${status}-${'x'.repeat(40)}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: account.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: rawToken, newPassword })
      .expect(204);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.role).toBe(role);
    expect(updated.status).toBe(status);
    expect(updated.isActive).toBe(isActive);
  });

  it('revokes an expired token and rejects it with the generic reset error', async () => {
    const account = await prisma.user.create({
      data: {
        email: 'expired@password-reset.test',
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        isActive: true,
        passwordHash: await hash(originalPassword, 12),
      },
    });
    const rawToken = `expired-${'x'.repeat(40)}`;
    const token = await prisma.passwordResetToken.create({
      data: {
        userId: account.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', 'http://localhost:3000')
      .send({ token: rawToken, newPassword })
      .expect(400);
    expect(response.body.message).toBe('This password reset link is invalid or has expired.');
    expect(
      (await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('enforces normalized-email and IP rate limits with 429 responses', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('Origin', 'http://localhost:3000')
        .set('X-Forwarded-For', `10.2.0.${index + 1}`)
        .send({ email: index % 2 ? 'RATE@password-reset.test' : 'rate@password-reset.test' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', '10.2.0.4')
      .send({ email: 'rate@password-reset.test' })
      .expect(429);

    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('Origin', 'http://localhost:3000')
        .set('X-Forwarded-For', '10.3.0.1')
        .send({ email: `ip-rate-${index}@password-reset.test` })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('Origin', 'http://localhost:3000')
      .set('X-Forwarded-For', '10.3.0.1')
      .send({ email: 'ip-rate-6@password-reset.test' })
      .expect(429);
  });
});
