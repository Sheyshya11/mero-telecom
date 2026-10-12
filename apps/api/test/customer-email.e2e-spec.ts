import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import configuration from '../src/config/configuration';
import { validationSchema } from '../src/config/env.validation';
import { configureApplication } from '../src/configure-application';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { CacheModule } from '../src/modules/cache/cache.module';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { EmailQueueService } from '../src/modules/notifications/email-queue.service';
const password = 'CustomerPassword1!';
describe('Customer-owned email changes (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let passwordHash: string;
  const ids: string[] = [];
  const customerIds: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
          validationSchema,
        }),
        DatabaseModule,
        CacheModule,
        CustomersModule,
      ],
    })
      .overrideProvider(EmailQueueService)
      .useValue({
        enqueue: jest.fn().mockResolvedValue({ jobId: 'email', recipient: 'test@example.com' }),
      })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    db = app.get(PrismaService);
    passwordHash = await hash(password, 4);
  });
  afterAll(async () => {
    if (db) {
      await db.customerAddress.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.customer.deleteMany({ where: { id: { in: customerIds } } });
      await db.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });
  async function fixture(role: Role = Role.CUSTOMER) {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@customer-email.test`,
        passwordHash,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
        isActive: true,
        roles: { create: { role } },
      },
    });
    ids.push(user.id);
    if (role === Role.CUSTOMER) {
      const customer = await db.customer.create({
        data: {
          userId: user.id,
          customerNumber: randomUUID().slice(0, 20),
          firstName: 'Email',
          lastName: 'Owner',
          email: user.email,
          phone: '0400000000',
          addressLine1: '1 Road',
          suburb: 'Adelaide',
          state: 'SA',
          postcode: '5000',
          status: 'ACTIVE',
        },
      });
      customerIds.push(customer.id);
      return { user, customer };
    }
    return { user, customer: null };
  }
  async function login(email: string) {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password })
      .expect(200);
    return String(result.body.accessToken);
  }
  function own(token: string) {
    return request(app.getHttpServer())
      .patch('/api/v1/customers/me/email')
      .set('Authorization', `Bearer ${token}`);
  }
  it.each([Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF])(
    'forbids %s from changing an existing customer email through either route',
    async (role) => {
      const owner = await fixture();
      const internal = await fixture(role);
      const token = await login(internal.user.email);
      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${owner.customer!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'replacement@customer-email.test' })
        .expect(403);
      await own(token)
        .send({ newEmail: 'replacement@customer-email.test', currentPassword: password })
        .expect(403);
      expect((await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).email).toBe(
        owner.user.email,
      );
      expect(
        (await db.customer.findUniqueOrThrow({ where: { id: owner.customer!.id } })).email,
      ).toBe(owner.user.email);
    },
  );
  it('updates only the owner, keeps login/contact email aligned and invalidates other sessions and old reset links', async () => {
    const owner = await fixture();
    const other = await fixture();
    const token = await login(owner.user.email);
    const oldDevice = await login(owner.user.email);
    const reset = await db.passwordResetToken.create({
      data: {
        userId: owner.user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const email = `${randomUUID()}@customer-email.test`;
    await own(token)
      .send({ newEmail: ` ${email.toUpperCase()} `, currentPassword: password })
      .expect(200)
      .expect(({ body }) => expect(body.email).toBe(email));
    const updated = await db.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(updated.email).toBe(email);
    expect(updated.emailVerifiedAt).toBeNull();
    expect(updated.status).toBe('ACTIVE');
    expect((await db.user.findUniqueOrThrow({ where: { id: other.user.id } })).email).toBe(
      other.user.email,
    );
    expect(
      (await db.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } })).revokedAt,
    ).not.toBeNull();
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body.email).toBe(email));
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldDevice}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email: owner.user.email, password })
      .expect(401);
    await login(email);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { actorUserId: owner.user.id, action: 'CUSTOMER_EMAIL_CHANGED' },
    });
    expect(audit.entityId).toBe(owner.customer!.id);
    expect(JSON.stringify(audit.metadata)).not.toContain(password);
    const admin = await fixture(Role.ADMIN);
    const adminToken = await login(admin.user.email);
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${owner.customer!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE', phone: '0400000001', email })
      .expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).status).toBe(
      'ACTIVE',
    );
  });
  it('rejects missing and incorrect passwords, invalid email and another customer identifier', async () => {
    const owner = await fixture();
    const other = await fixture();
    const token = await login(owner.user.email);
    for (const body of [
      { newEmail: 'new@customer-email.test' },
      { newEmail: 'new@customer-email.test', currentPassword: 'wrong' },
      { newEmail: 'invalid', currentPassword: password },
      {
        newEmail: 'new@customer-email.test',
        currentPassword: password,
        customerId: other.customer!.id,
      },
    ])
      await own(token).send(body).expect(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).email).toBe(
      owner.user.email,
    );
  });
  it('rolls back both emails when the address is already in use', async () => {
    const owner = await fixture();
    const other = await fixture();
    const token = await login(owner.user.email);
    await own(token).send({ newEmail: other.user.email, currentPassword: password }).expect(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).email).toBe(
      owner.user.email,
    );
    expect((await db.customer.findUniqueOrThrow({ where: { id: owner.customer!.id } })).email).toBe(
      owner.user.email,
    );
  });
  it('rejects direct email edits through the generic own profile endpoint', async () => {
    const owner = await fixture();
    const token = await login(owner.user.email);
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'bypass@customer-email.test' })
      .expect(400);
  });
  it('requires an authenticated customer session', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me/email')
      .send({ newEmail: 'new@customer-email.test', currentPassword: password })
      .expect(401);
  });
});
