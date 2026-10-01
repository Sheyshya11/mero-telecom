import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationSeverity, Role, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { PrismaService } from '../src/database/prisma.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';

describe('Notification centre API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailProvider)
      .useValue({ send: jest.fn().mockResolvedValue({ messageId: 'notification-e2e' }) })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: { endsWith: '@notifications.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@notifications.test' } } });
    await app.close();
  });

  async function createUser(role: Role, localPart = role.toLowerCase()) {
    return prisma.user.create({
      data: {
        email: `${localPart}@notifications.test`,
        displayName: `${role} notifications`,
        roles: { create: { role } },
        status: UserStatus.ACTIVE,
        isActive: true,
        passwordHash: await hash('NotificationPassword1!', 12),
      },
    });
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password: 'NotificationPassword1!' })
      .expect(200);
    return response.body.accessToken as string;
  }

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
    await request(app.getHttpServer()).get('/api/v1/notifications/unread-count').expect(401);
  });

  it('isolates list, unread, and read state for every authenticated role', async () => {
    for (const role of [Role.CUSTOMER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN]) {
      const user = await createUser(role, `${role.toLowerCase()}-matrix`);
      const token = await login(user.email);
      const own = await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'GENERAL',
          severity: NotificationSeverity.INFO,
          title: `${role} notification`,
          message: 'This notification belongs only to its addressed user.',
          deduplicationKey: `e2e-${role}`,
        },
      });

      const list = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ id: own.id, title: `${role} notification`, isRead: false }),
      ]);

      const unread = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(unread.body).toEqual({ count: 1 });

      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${own.id}/read`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect(({ body }) => expect(body).toEqual(expect.objectContaining({ isRead: true })));
    }
  });

  it("does not allow one user to mutate another user's notification", async () => {
    const owner = await createUser(Role.CUSTOMER, 'owner-isolation');
    const attacker = await createUser(Role.ADMIN, 'attacker-isolation');
    const attackerToken = await login(attacker.email);
    const notification = await prisma.notification.create({
      data: {
        userId: owner.id,
        type: 'PROFILE_UPDATED',
        severity: NotificationSeverity.INFO,
        title: 'Account details updated',
        message: 'Your account information was recently updated.',
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/notifications/${notification.id}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(404);
  });
});
