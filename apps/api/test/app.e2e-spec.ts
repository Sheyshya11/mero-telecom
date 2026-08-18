import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvoiceStatus, Role, SubscriptionStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { PrismaService } from '../src/database/prisma.service';

const password = 'ChangeMe123!';
const customerInput = {
  firstName: 'Test',
  lastName: 'Customer',
  email: 'created.customer@merotelecom.test',
  phone: '+61400000009',
  addressLine1: '9 Test Street',
  addressLine2: '',
  suburb: 'Sydney',
  state: 'NSW',
  postcode: '2000',
};

describe('Mero Telecom API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let staffToken: string;
  let customerToken: string;
  let customerAId: string;
  let customerBId: string;
  let planId: string;
  let invoiceAId: string;
  let invoiceBId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.paymentWebhookEvent.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.invoiceDocument.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.refreshSession.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.internetPlan.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await hash(password, 12);
    const [admin, staff, customerAUser, customerBUser] = await Promise.all([
      prisma.user.create({
        data: { email: 'admin@merotelecom.test', passwordHash, role: Role.ADMIN },
      }),
      prisma.user.create({
        data: { email: 'staff@merotelecom.test', passwordHash, role: Role.STAFF },
      }),
      prisma.user.create({
        data: { email: 'customer@merotelecom.test', passwordHash, role: Role.CUSTOMER },
      }),
      prisma.user.create({
        data: { email: 'customer-b@merotelecom.test', passwordHash, role: Role.CUSTOMER },
      }),
    ]);
    expect(admin.id).toBeDefined();
    expect(staff.id).toBeDefined();

    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({
        data: {
          userId: customerAUser.id,
          customerNumber: 'CUST-E2E-0001',
          firstName: 'Anika',
          lastName: 'Singh',
          email: customerAUser.email,
          phone: '+61400000001',
          addressLine1: '1 George Street',
          suburb: 'Sydney',
          state: 'NSW',
          postcode: '2000',
        },
      }),
      prisma.customer.create({
        data: {
          userId: customerBUser.id,
          customerNumber: 'CUST-E2E-0002',
          firstName: 'Noah',
          lastName: 'Williams',
          email: customerBUser.email,
          phone: '+61400000002',
          addressLine1: '2 George Street',
          suburb: 'Sydney',
          state: 'NSW',
          postcode: '2000',
        },
      }),
    ]);
    customerAId = customerA.id;
    customerBId = customerB.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('handles failed login, refresh rotation, and logout revocation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@merotelecom.test', password: 'wrong-password' })
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@merotelecom.test', password })
      .expect(200);
    const firstCookie = cookieFrom(login.headers['set-cookie']);
    expect(login.body.accessToken).toEqual(expect.any(String));

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);
    const rotatedCookie = cookieFrom(refreshed.headers['set-cookie']);
    expect(rotatedCookie).not.toBe(firstCookie);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', rotatedCookie)
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);
  });

  it('enforces validation and admin/staff role boundaries', async () => {
    adminToken = await loginAs('admin@merotelecom.test');
    staffToken = await loginAs('staff@merotelecom.test');

    await request(app.getHttpServer())
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Forbidden plan', downloadMbps: 10, uploadMbps: 5, monthlyCents: 5000 })
      .expect(403);

    const createdCustomer = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerInput)
      .expect(201);
    expect(createdCustomer.body.customerNumber).toMatch(/^CUST-/);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerInput)
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...customerInput, email: 'invalid' })
      .expect(400);

    const staffList = await request(app.getHttpServer())
      .get('/api/v1/customers?search=Anika')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(staffList.body.data).toHaveLength(1);
    const staffUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerAId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ firstName: 'Not permitted', phone: '+61400000003' })
      .expect(200);
    expect(staffUpdate.body.firstName).toBe('Anika');
    expect(staffUpdate.body.phone).toBe('+61400000003');
  });

  it('creates subscriptions and deterministic invoices through the API', async () => {
    const plan = await request(app.getHttpServer())
      .post('/api/v1/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Essential 50',
        description: 'End-to-end test plan',
        downloadMbps: 50,
        uploadMbps: 20,
        monthlyCents: 6900,
      })
      .expect(201);
    planId = plan.body.id;

    const subscriptionA = await createAndActivateSubscription(customerAId);
    const subscriptionB = await createAndActivateSubscription(customerBId);
    expect(subscriptionA.status).toBe(SubscriptionStatus.ACTIVE);

    const invoiceA = await generateInvoice(subscriptionA.id, '2026-09-01');
    const invoiceB = await generateInvoice(subscriptionB.id, '2026-09-01');
    invoiceAId = invoiceA.id;
    invoiceBId = invoiceB.id;
    expect(invoiceA).toEqual(
      expect.objectContaining({
        subtotalCents: 6273,
        taxCents: 627,
        totalCents: 6900,
        status: InvoiceStatus.ISSUED,
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subscriptionId: subscriptionA.id, issueDate: '2026-09-01' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceAId}/pdf`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', /INV-2026-/)
      .expect(200);
  });

  it('protects customer ownership and permits approved self-service updates', async () => {
    customerToken = await loginAs('customer@merotelecom.test');
    await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceAId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceBId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerBId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const update = await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ phone: '+61400000004', suburb: 'Barangaroo' })
      .expect(200);
    expect(update.body.phone).toBe('+61400000004');
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(400);
  });

  it('returns readiness, public coverage, and administrative audit evidence', async () => {
    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ database: 'ok', redis: 'ok' });
    expect(ready.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const covered = await request(app.getHttpServer())
      .get('/api/v1/coverage?postcode=2000')
      .expect(200);
    expect(covered.body).toEqual(expect.objectContaining({ status: 'AVAILABLE' }));
    expect(covered.body.plans).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: planId })]),
    );
    await request(app.getHttpServer()).get('/api/v1/coverage?postcode=20').expect(400);

    const auditCount = await prisma.auditLog.count({
      where: { actor: { role: { in: [Role.ADMIN, Role.STAFF] } } },
    });
    expect(auditCount).toBeGreaterThanOrEqual(5);
  });

  async function loginAs(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function createAndActivateSubscription(customerId: string) {
    const created = await request(app.getHttpServer())
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerId, planId, startDate: '2026-09-01' })
      .expect(201);
    const active = await request(app.getHttpServer())
      .patch(`/api/v1/subscriptions/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: SubscriptionStatus.ACTIVE })
      .expect(200);
    return active.body;
  }

  async function generateInvoice(subscriptionId: string, issueDate: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/invoices/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subscriptionId, issueDate })
      .expect(201);
    return response.body;
  }
});

function cookieFrom(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error('Expected a refresh cookie.');
  return cookie.split(';')[0];
}
