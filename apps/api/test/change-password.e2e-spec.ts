import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { PrismaService } from '../src/database/prisma.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';

const originalPassword = 'OriginalPassword1!';
const changedPassword = 'ChangedPassword2!';
const nextPassword = 'AnotherPassword3!';

async function waitUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the password-change email worker.');
}

function sessionId(accessToken: string): string {
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sid: string };
  return payload.sid;
}

describe('Change password API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sendEmail = jest.fn().mockResolvedValue({ messageId: 'change-password-e2e-message' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailProvider)
      .useValue({ send: sendEmail })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@change-password.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@change-password.test' } } });
    await app.close();
  });

  async function createUser(localPart: string, role: Role) {
    return prisma.user.create({
      data: {
        email: `${localPart}@change-password.test`,
        displayName: `${role} Account`,
        roles: { create: { role } },
        status: UserStatus.ACTIVE,
        isActive: true,
        passwordHash: await hash(originalPassword, 12),
      },
    });
  }

  async function login(email: string, password = originalPassword) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password })
      .expect(200);
    return {
      accessToken: response.body.accessToken as string,
      cookie: (response.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '',
    };
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .send({
        currentPassword: originalPassword,
        newPassword: changedPassword,
        confirmPassword: changedPassword,
      })
      .expect(401);
  });

  it('validates, changes only the authenticated account, retains the current session, and records security events', async () => {
    const owner = await createUser('owner', Role.CUSTOMER);
    const other = await createUser('other', Role.CUSTOMER);
    const currentDevice = await login(owner.email);
    const otherDevice = await login(owner.email);
    const currentSessionId = sessionId(currentDevice.accessToken);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.1')
      .send({
        currentPassword: originalPassword,
        newPassword: changedPassword,
        confirmPassword: changedPassword,
        userId: other.id,
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.2')
      .send({ currentPassword: originalPassword, newPassword: 'weak', confirmPassword: 'weak' })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.3')
      .send({
        currentPassword: originalPassword,
        newPassword: changedPassword,
        confirmPassword: nextPassword,
      })
      .expect(400);

    const incorrect = await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.4')
      .send({
        currentPassword: 'IncorrectPassword9!',
        newPassword: changedPassword,
        confirmPassword: changedPassword,
      })
      .expect(400);
    expect(incorrect.body.message).toBe('Current password is incorrect.');

    const same = await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.5')
      .send({
        currentPassword: originalPassword,
        newPassword: originalPassword,
        confirmPassword: originalPassword,
      })
      .expect(400);
    expect(same.body.message).toBe('New password must be different from the current password.');

    const emailCallCount = sendEmail.mock.calls.length;
    const changed = await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .set('X-Forwarded-For', '10.10.1.6')
      .set('User-Agent', 'Change password e2e browser')
      .send({
        currentPassword: originalPassword,
        newPassword: changedPassword,
        confirmPassword: changedPassword,
      })
      .expect(200);
    expect(changed.body).toEqual({ success: true, message: 'Password changed successfully.' });

    const updatedOwner = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const unchangedOther = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(await compare(changedPassword, updatedOwner.passwordHash ?? '')).toBe(true);
    expect(await compare(originalPassword, updatedOwner.passwordHash ?? '')).toBe(false);
    expect(await compare(originalPassword, unchangedOther.passwordHash ?? '')).toBe(true);

    const activeSessions = await prisma.refreshSession.findMany({
      where: { userId: owner.id, revokedAt: null },
      select: { id: true },
    });
    expect(activeSessions).toEqual([{ id: currentSessionId }]);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${currentDevice.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', otherDevice.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', currentDevice.cookie)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: owner.email, password: originalPassword })
      .expect(401);
    await login(owner.email, changedPassword);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId: owner.id, type: 'PASSWORD_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification.title).toBe('Password changed');
    expect(notification.message).toBe('Your account password was changed successfully.');
    expect(notification.actionUrl).toBe('/account/security');
    expect(notification.metadata).toMatchObject({ category: 'SECURITY', priority: 'HIGH' });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: owner.id, action: 'PASSWORD_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({
      currentSessionRetained: true,
      sessionsRevoked: 1,
      ipAddress: '10.10.1.6',
      userAgent: 'Change password e2e browser',
    });
    const securityRecords = JSON.stringify({ notification, audit });
    expect(securityRecords).not.toContain(originalPassword);
    expect(securityRecords).not.toContain(changedPassword);
    expect(securityRecords).not.toContain(updatedOwner.passwordHash);

    await waitUntil(() =>
      sendEmail.mock.calls
        .slice(emailCallCount)
        .some(
          (call) =>
            (call[0] as { subject: string }).subject === 'Your Mero Telecom password was changed',
        ),
    );
    const email = sendEmail.mock.calls
      .slice(emailCallCount)
      .map((call) => call[0] as { subject: string; text: string })
      .find((message) => message.subject === 'Your Mero Telecom password was changed');
    expect(email?.text).toContain('If you made this change, no further action is required.');
    expect(email?.text).toContain('Your current session remains active.');
    expect(email?.text).not.toContain(changedPassword);
  });

  it.each([Role.CUSTOMER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN])(
    'allows %s to change only their own password',
    async (role) => {
      const account = await createUser(`role-${role.toLowerCase()}`, role);
      const session = await login(account.email);

      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('X-Forwarded-For', `10.20.${Object.values(Role).indexOf(role) + 1}.1`)
        .send({
          currentPassword: originalPassword,
          newPassword: changedPassword,
          confirmPassword: changedPassword,
        })
        .expect(200);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(await compare(changedPassword, updated.passwordHash ?? '')).toBe(true);
    },
  );

  it('serializes duplicate requests so the password changes once', async () => {
    const account = await createUser('duplicate', Role.CUSTOMER);
    const session = await login(account.email);
    const body = {
      currentPassword: originalPassword,
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    };

    const responses = await Promise.all([
      request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('X-Forwarded-For', '10.30.1.1')
        .send(body),
      request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('X-Forwarded-For', '10.30.1.2')
        .send(body),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(await compare(nextPassword, updated.passwordHash ?? '')).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: account.id, action: 'PASSWORD_CHANGED' },
      }),
    ).toBe(1);
  });

  it('rate limits repeated attempts', async () => {
    const account = await createUser('rate-limit', Role.CUSTOMER);
    const session = await login(account.email);
    const body = {
      currentPassword: originalPassword,
      newPassword: 'weak',
      confirmPassword: 'weak',
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .set('X-Forwarded-For', '10.40.1.1')
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('X-Forwarded-For', '10.40.1.1')
      .send(body)
      .expect(429);
  });
});
