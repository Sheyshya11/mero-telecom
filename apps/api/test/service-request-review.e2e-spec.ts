import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import configuration from '../src/config/configuration';
import { validationSchema } from '../src/config/env.validation';
import { configureApplication } from '../src/configure-application';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { CacheModule } from '../src/modules/cache/cache.module';
import { CancellationsModule } from '../src/modules/cancellations/cancellations.module';
import { CancellationsService } from '../src/modules/cancellations/cancellations.service';
import { CancellationReconciliationSchedulerService } from '../src/modules/cancellations/cancellation-reconciliation-scheduler.service';
import { WholesaleDisconnectionProvider } from '../src/modules/cancellations/providers/wholesale-disconnection.provider';
import { RelocationsModule } from '../src/modules/relocations/relocations.module';
import { RelocationsService } from '../src/modules/relocations/relocations.service';
import { RelocationReconciliationSchedulerService } from '../src/modules/relocations/relocation-reconciliation-scheduler.service';
import { ServiceRelocationProvider } from '../src/modules/relocations/providers/service-relocation.provider';
import { CoverageService } from '../src/modules/coverage/coverage.service';
import { OverdueLifecycleSchedulerService } from '../src/modules/subscriptions/overdue-lifecycle-scheduler.service';
import { EmailQueueService } from '../src/modules/notifications/email-queue.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';
import { InAppNotificationService } from '../src/modules/notifications/in-app-notification.service';
import { StripeClientService } from '../src/modules/payments/stripe-client.service';
import { DashboardModule } from '../src/modules/dashboard/dashboard.module';

const prefix = '/api/v1';
const password = 'ServiceReviewPassword1!';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const date = (offset: number) => day(offset).toISOString().slice(0, 10);

describe('Employee service request review (PostgreSQL e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let cancellations: CancellationsService;
  let relocations: RelocationsService;
  let inApp: InAppNotificationService;
  let planId: string;
  let passwordHash: string;
  const customerIds: string[] = [];
  const userIds: string[] = [];
  const entityIds: string[] = [];
  const employees: Array<{ id: string; token: string; role: Role }> = [];
  const emails = new Set<string>();
  const emailQueue = {
    enqueue: jest.fn(async (_message: unknown, _context: unknown, key: string) => {
      emails.add(key);
      return { jobId: key, recipient: 'review@example.test' };
    }),
  };
  const stripe = {
    subscriptions: {
      update: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
    },
  };
  const cancellationProvider = {
    name: 'MOCK_REVIEW',
    simulated: true,
    requestDisconnection: jest.fn(async (input: { requestNumber: string }) => ({
      providerReference: `mock-cancel-${input.requestNumber}`,
      status: 'PENDING',
      payload: {},
    })),
    getDisconnectionStatus: jest.fn(async (input: { providerReference: string }) => ({
      providerReference: input.providerReference,
      status: 'COMPLETED',
      payload: {},
    })),
  };
  const relocationProvider = {
    name: 'MOCK_REVIEW',
    simulated: true,
    requestProvisioning: jest
      .fn()
      .mockResolvedValue({ providerReference: 'mock-move', status: 'PENDING', payload: {} }),
    getProvisioningStatus: jest
      .fn()
      .mockResolvedValue({ providerReference: 'mock-move', status: 'COMPLETED', payload: {} }),
    requestDisconnection: jest
      .fn()
      .mockResolvedValue({ providerReference: 'mock-old', status: 'COMPLETED', payload: {} }),
    getDisconnectionStatus: jest
      .fn()
      .mockResolvedValue({ providerReference: 'mock-old', status: 'COMPLETED', payload: {} }),
  };
  const coverage = {
    consumeQualificationForPlan: jest.fn(async () => ({
      address: {
        provider: 'geoapify',
        providerAddressId: 'mock-address',
        formattedAddress: '25 Example Street, Adelaide SA 5000',
        unit: null,
        houseNumber: '25',
        street: 'Example Street',
        suburb: 'Adelaide',
        city: 'Adelaide',
        state: 'South Australia',
        stateCode: 'SA',
        postcode: '5000',
        countryCode: 'au',
        latitude: -34.92,
        longitude: 138.6,
      },
      compatiblePlanIds: [planId],
      technology: 'FTTP',
      maximumSpeedMbps: 1000,
      checkedAt: new Date().toISOString(),
      expiresAt: day(1).toISOString(),
    })),
  };

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
        CancellationsModule,
        RelocationsModule,
        DashboardModule,
      ],
    })
      .overrideProvider(CancellationReconciliationSchedulerService)
      .useValue({})
      .overrideProvider(RelocationReconciliationSchedulerService)
      .useValue({})
      .overrideProvider(OverdueLifecycleSchedulerService)
      .useValue({})
      .overrideProvider(EmailQueueService)
      .useValue(emailQueue)
      .overrideProvider(EmailProvider)
      .useValue({ send: jest.fn() })
      .overrideProvider(StripeClientService)
      .useValue({ client: stripe })
      .overrideProvider(WholesaleDisconnectionProvider)
      .useValue(cancellationProvider)
      .overrideProvider(ServiceRelocationProvider)
      .useValue(relocationProvider)
      .overrideProvider(CoverageService)
      .useValue(coverage)
      .compile();
    app = module.createNestApplication();
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    db = app.get(PrismaService);
    cancellations = app.get(CancellationsService);
    relocations = app.get(RelocationsService);
    inApp = app.get(InAppNotificationService);
    passwordHash = await hash(password, 4);
    const plan = await db.internetPlan.create({
      data: {
        name: `Review ${randomUUID()}`,
        monthlyCents: 7990,
        downloadMbps: 100,
        uploadMbps: 20,
        isPublic: true,
        isAvailable: true,
      },
    });
    planId = plan.id;
    for (const role of [Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN]) {
      const user = await db.user.create({
        data: { email: `${randomUUID()}@review.test`, passwordHash, roles: { create: { role } } },
      });
      userIds.push(user.id);
      employees.push({ id: user.id, role, token: await token(user.email) });
    }
  });
  afterAll(async () => {
    if (db) {
      // Delete only records created by this suite; never reset shared databases.
      const requests = await db.cancellationRequest.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      const moves = await db.serviceRelocation.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      entityIds.push(...requests.map((x) => x.id), ...moves.map((x) => x.id));
      await db.notification.deleteMany({
        where: { OR: [{ userId: { in: userIds } }, { entityId: { in: entityIds } }] },
      });
      const refunds = await db.refund.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      entityIds.push(...refunds.map((x) => x.id));
      await db.refund.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.payment.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.cancellationRequest.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.serviceRelocation.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.subscription.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.customer.deleteMany({ where: { id: { in: customerIds } } });
      await db.auditLog.deleteMany({
        where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: entityIds } }] },
      });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      if (planId) await db.internetPlan.delete({ where: { id: planId } });
    }
    await app?.close();
  });
  beforeEach(() => jest.clearAllMocks());

  async function token(email: string) {
    const response = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .set('Origin', 'http://localhost:3000')
      .send({ email, password })
      .expect(200);
    return String(response.body.accessToken);
  }
  async function fixture(withAddress = true) {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@review.test`,
        passwordHash,
        roles: { create: { role: Role.CUSTOMER } },
      },
    });
    userIds.push(user.id);
    const customer = await db.customer.create({
      data: {
        userId: user.id,
        customerNumber: randomUUID().slice(0, 20),
        firstName: 'Review',
        lastName: 'Customer',
        email: user.email,
        phone: '0400000000',
        addressLine1: '10 Old Street',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
        addresses: {
          create: [
            {
              type: 'SERVICE',
              addressLine1: '10 Old Street',
              suburb: 'Adelaide',
              state: 'SA',
              postcode: '5000',
            },
            {
              type: 'BILLING',
              addressLine1: '40 Billing Street',
              suburb: 'Norwood',
              state: 'SA',
              postcode: '5067',
            },
          ],
        },
      },
    });
    customerIds.push(customer.id);
    const address = withAddress
      ? await db.serviceAddress.create({
          data: {
            customerId: customer.id,
            addressLine1: '10 Old Street',
            suburb: 'Adelaide',
            state: 'SA',
            postcode: '5000',
          },
        })
      : null;
    const sub = await db.subscription.create({
      data: {
        customerId: customer.id,
        planId,
        monthlyCents: 7990,
        status: 'ACTIVE',
        billingMode: 'STRIPE_RECURRING',
        stripeSubscriptionId: `sub_review_${randomUUID()}`,
        currentServiceAddressId: address?.id,
        startDate: day(-10),
        currentPeriodStart: day(-10),
        currentPeriodEnd: day(20),
        billingAnchorDay: 1,
      },
    });
    entityIds.push(sub.id);
    return { user, customer, sub, token: await token(user.email) };
  }
  async function submitCancellation(f: Awaited<ReturnType<typeof fixture>>, type = 'IMMEDIATE') {
    const response = await request(app.getHttpServer())
      .post(`${prefix}/subscriptions/${f.sub.id}/cancellation`)
      .auth(f.token, { type: 'bearer' })
      .send({ type, reason: 'MOVING_HOME', reasonDetails: 'Moving overseas', confirmed: true });
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
    return response.body;
  }
  async function submitMove(f: Awaited<ReturnType<typeof fixture>>, offset = 0) {
    const response = await request(app.getHttpServer())
      .post(`${prefix}/subscriptions/${f.sub.id}/relocations`)
      .auth(f.token, { type: 'bearer' })
      .send({
        qualificationToken: 'q'.repeat(43),
        requestedPlanId: planId,
        requestedMoveDate: date(offset),
        billingSameAsService: true,
        customerComments: 'Please call before installation.',
      });
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
    return response.body;
  }
  function decision(kind: string, id: string, action: string, employee = employees[0], body = {}) {
    return request(app.getHttpServer())
      .post(
        `${prefix}/${kind === 'cancel' ? 'admin/cancellations' : 'relocations'}/${id}/${action}`,
      )
      .auth(employee.token, { type: 'bearer' })
      .send(body);
  }
  async function unchanged(f: Awaited<ReturnType<typeof fixture>>) {
    const current = await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } });
    expect(current).toEqual(f.sub);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } });
    expect(customer).toEqual(f.customer);
    const addresses = await db.customerAddress.findMany({
      where: { customerId: f.customer.id },
      orderBy: { type: 'asc' },
    });
    expect(addresses.map((a) => a.addressLine1).sort()).toEqual([
      '10 Old Street',
      '40 Billing Street',
    ]);
    expect(await db.refund.count({ where: { subscriptionId: f.sub.id } })).toBe(0);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(cancellationProvider.requestDisconnection).not.toHaveBeenCalled();
    expect(relocationProvider.requestProvisioning).not.toHaveBeenCalled();
    expect(relocationProvider.requestDisconnection).not.toHaveBeenCalled();
  }
  async function verifyRequestedNotifications(
    id: string,
    userId: string,
    kind: 'CANCELLATION' | 'RELOCATION',
  ) {
    const customer = await db.notification.findMany({ where: { entityId: id, userId } });
    expect(customer).toEqual([
      expect.objectContaining({
        type: `${kind}_REQUESTED`,
        severity: 'INFO',
        actionUrl:
          kind === 'CANCELLATION' ? '/customer/subscription' : '/customer/subscription/moving-home',
      }),
    ]);
    for (const employee of employees) {
      const operations = await db.notification.findMany({
        where: { entityId: id, userId: employee.id },
      });
      expect(operations).toEqual([
        expect.objectContaining({
          type: `${kind}_REVIEW_REQUIRED`,
          severity: 'ACTION_REQUIRED',
          actionUrl:
            kind === 'CANCELLATION'
              ? expect.stringContaining('/control-centre/cancellations?request=')
              : `/control-centre/relocations/${id}`,
        }),
      ]);
    }
  }

  it('creates cancellation pending review with no billing, Stripe, provider or refund side effects, including duplicate submission', async () => {
    const f = await fixture();
    const response = await submitCancellation(f);
    const retry = await submitCancellation(f);
    expect(response.status).toBe('PENDING_REVIEW');
    expect(retry.id).toBe(response.id);
    await cancellations.process(response.id);
    await cancellations.reconcileDue();
    await unchanged(f);
    await verifyRequestedNotifications(response.id, f.user.id, 'CANCELLATION');
  });
  it('creates relocation pending review, even with a legacy missing service-address pointer, without changing either active address', async () => {
    const f = await fixture(false);
    const move = await submitMove(f);
    expect(move.status).toBe('PENDING_REVIEW');
    await relocations.processProvisioning(move.id, true);
    await relocations.processDisconnection(move.id, true);
    await relocations.reconcileDue(100);
    await unchanged(f);
    await verifyRequestedNotifications(move.id, f.user.id, 'RELOCATION');
    expect(move.qualification.source).toBe('DATABASE_ESTIMATE');
    expect(move.customerComments).toBe('Please call before installation.');
  });
  it('permits Staff approval once, starts existing cancellation processing, and reports completion only after provider success', async () => {
    const f = await fixture();
    const c = await submitCancellation(f);
    const approved = await decision('cancel', c.requestNumber, 'approve', employees[0], {
      reviewNotes: 'Private review note',
    }).expect(201);
    expect(approved.body.reviewDecision).toBe('APPROVED');
    expect(approved.body.reviewedByUserId).toBe(employees[0].id);
    expect(approved.body.status).toBe('DISCONNECTION_PENDING');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    expect(cancellationProvider.requestDisconnection).toHaveBeenCalledTimes(1);
    expect(
      await db.notification.count({ where: { entityId: c.id, type: 'SUBSCRIPTION_CANCELLED' } }),
    ).toBe(0);
    await decision('cancel', c.requestNumber, 'approve', employees[1]).expect(201);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    expect(cancellationProvider.requestDisconnection).toHaveBeenCalledTimes(1);
    await cancellations.process(c.id);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })).status).toBe(
      'CANCELLED',
    );
    expect(
      await db.notification.count({
        where: { entityId: c.id, type: 'SUBSCRIPTION_CANCELLED', userId: f.user.id },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: c.id, action: 'CANCELLATION_APPROVED' } }),
    ).toBe(1);
  });
  it('keeps an approved end-of-period cancellation scheduled and does not announce completion', async () => {
    const f = await fixture();
    const c = await submitCancellation(f, 'END_OF_PERIOD');
    const approved = await decision('cancel', c.requestNumber, 'approve', employees[1]).expect(201);
    expect(approved.body.status).toBe('SCHEDULED');
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(cancellationProvider.requestDisconnection).not.toHaveBeenCalled();
    expect(
      await db.notification.count({ where: { entityId: c.id, type: 'SUBSCRIPTION_CANCELLED' } }),
    ).toBe(0);
    // Revoke using the existing operational permission and clear it from later scheduler tests.
    await request(app.getHttpServer())
      .post(`${prefix}/subscriptions/${f.sub.id}/cancellation/revoke`)
      .auth(f.token, { type: 'bearer' })
      .send({})
      .expect(201);
  });
  it('permits Admin relocation approval without switching addresses until activation and waits for old-service completion', async () => {
    const f = await fixture();
    const move = await submitMove(f);
    const approved = await decision('move', move.id, 'approve', employees[1], {
      reviewNotes: 'Private move note',
    }).expect(201);
    expect(approved.body.status).toBe('PROVISIONING');
    expect(approved.body.reviewDecision).toBe('APPROVED');
    expect(relocationProvider.requestProvisioning).toHaveBeenCalledTimes(1);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } }))
        .currentServiceAddressId,
    ).toBe(f.sub.currentServiceAddressId);
    expect(
      await db.notification.count({ where: { entityId: move.id, type: 'RELOCATION_COMPLETED' } }),
    ).toBe(0);
    await decision('move', move.id, 'approve', employees[2]).expect(201);
    expect(relocationProvider.requestProvisioning).toHaveBeenCalledTimes(1);
    await relocations.processProvisioning(move.id);
    const completed = await db.serviceRelocation.findUniqueOrThrow({ where: { id: move.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.oldServiceDisconnectedAt).not.toBeNull();
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } }))
        .currentServiceAddressId,
    ).toBe(move.newServiceAddress.id);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).addressLine1,
    ).toBe('25 Example Street');
    expect(
      await db.notification.count({
        where: {
          entityId: move.id,
          type: 'RELOCATION_COMPLETED',
          userId: f.user.id,
          severity: 'SUCCESS',
        },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: move.id, action: 'RELOCATION_APPROVED' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: move.id, action: 'RELOCATION_STARTED' } }),
    ).toBe(1);
  });
  it('permits Super Admin to approve a future move while leaving current service unchanged', async () => {
    const f = await fixture();
    const move = await submitMove(f, 15);
    const approved = await decision('move', move.id, 'approve', employees[2]).expect(201);
    expect(approved.body.status).toBe('SCHEDULED');
    await unchanged(f);
    await request(app.getHttpServer())
      .post(`${prefix}/relocations/${move.id}/cancel`)
      .auth(f.token, { type: 'bearer' })
      .send({})
      .expect(201);
  });
  it.each(['cancel', 'move'])(
    'rejects %s with a customer-safe reason, preserves all service state and keeps internal notes private',
    async (kind) => {
      const f = await fixture();
      const r = kind === 'cancel' ? await submitCancellation(f) : await submitMove(f);
      const id = kind === 'cancel' ? r.requestNumber : r.id;
      await decision(kind, id, 'reject', employees[0], { reason: '   ' }).expect(400);
      const result = await decision(kind, id, 'reject', employees[2], {
        reason: 'Please confirm the requested date with support.',
        reviewNotes: 'Internal sensitive review note',
      }).expect(201);
      expect(result.body.status).toBe('REJECTED');
      await unchanged(f);
      await decision(kind, id, 'reject', employees[1], { reason: 'Another reason' }).expect(201);
      await decision(kind, id, 'approve').expect(409);
      const customer = await request(app.getHttpServer())
        .get(
          `${prefix}/${kind === 'cancel' ? `subscriptions/${f.sub.id}/cancellation` : `relocations/${id}`}`,
        )
        .auth(f.token, { type: 'bearer' })
        .expect(200);
      const publicRecord = kind === 'cancel' ? customer.body.cancellation : customer.body;
      expect(publicRecord.rejectionReason).toBe('Please confirm the requested date with support.');
      expect(publicRecord.reviewNotes).toBeUndefined();
      expect(publicRecord.reviewedByUserId).toBeUndefined();
      expect(JSON.stringify(customer.body)).not.toContain('Internal sensitive');
      expect(
        await db.notification.count({
          where: {
            entityId: r.id,
            userId: f.user.id,
            type: kind === 'cancel' ? 'CANCELLATION_REJECTED' : 'RELOCATION_REJECTED',
          },
        }),
      ).toBe(1);
      const event = await db.auditLog.findFirstOrThrow({
        where: {
          entityId: r.id,
          action: kind === 'cancel' ? 'CANCELLATION_REJECTED' : 'RELOCATION_REJECTED',
        },
      });
      expect(event.actorUserId).toBe(employees[2].id);
    },
  );
  it.each(['cancel', 'move'])(
    'prevents customer and anonymous users from reviewing %s, including legacy confirmation routes',
    async (kind) => {
      const f = await fixture();
      const r = kind === 'cancel' ? await submitCancellation(f) : await submitMove(f);
      const base = `${prefix}/${kind === 'cancel' ? 'admin/cancellations' : 'relocations'}/${kind === 'cancel' ? r.requestNumber : r.id}`;
      for (const action of ['approve', 'reject', ...(kind === 'move' ? ['confirm'] : [])]) {
        await request(app.getHttpServer())
          .post(`${base}/${action}`)
          .auth(f.token, { type: 'bearer' })
          .send({ reason: 'No permission' })
          .expect(403);
        await request(app.getHttpServer())
          .post(`${base}/${action}`)
          .send({ reason: 'No permission' })
          .expect(401);
      }
      await unchanged(f);
    },
  );
  it.each(['cancel', 'move'])(
    'allows only one durable %s decision when reviewers approve and reject concurrently',
    async (kind) => {
      const f = await fixture();
      const r =
        kind === 'cancel' ? await submitCancellation(f, 'END_OF_PERIOD') : await submitMove(f, 15);
      const id = kind === 'cancel' ? r.requestNumber : r.id;
      const results = await Promise.all([
        decision(kind, id, 'approve', employees[0]),
        decision(kind, id, 'reject', employees[1], { reason: 'Please contact support first.' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const persisted =
        kind === 'cancel'
          ? await db.cancellationRequest.findUniqueOrThrow({ where: { id: r.id } })
          : await db.serviceRelocation.findUniqueOrThrow({ where: { id: r.id } });
      expect(persisted.reviewDecision).toBeTruthy();
      expect(persisted.reviewedAt).not.toBeNull();
      expect(
        await db.auditLog.count({
          where: {
            entityId: r.id,
            action: {
              in:
                kind === 'cancel'
                  ? ['CANCELLATION_APPROVED', 'CANCELLATION_REJECTED']
                  : ['RELOCATION_APPROVED', 'RELOCATION_REJECTED'],
            },
          },
        }),
      ).toBe(1);
      if (persisted.reviewDecision === 'APPROVED') {
        await request(app.getHttpServer())
          .post(
            `${prefix}/${kind === 'cancel' ? `subscriptions/${f.sub.id}/cancellation/revoke` : `relocations/${r.id}/cancel`}`,
          )
          .auth(f.token, { type: 'bearer' })
          .send({})
          .expect(201);
      }
    },
  );
  it.each(['cancel', 'move'])(
    'deduplicates simultaneous same-decision approvals for %s',
    async (kind) => {
      const f = await fixture();
      const r =
        kind === 'cancel' ? await submitCancellation(f, 'END_OF_PERIOD') : await submitMove(f, 15);
      const id = kind === 'cancel' ? r.requestNumber : r.id;
      const results = await Promise.all([
        decision(kind, id, 'approve', employees[0]),
        decision(kind, id, 'approve', employees[1]),
      ]);
      expect(results.map((x) => x.status)).toEqual([201, 201]);
      expect(
        await db.auditLog.count({
          where: {
            entityId: r.id,
            action: kind === 'cancel' ? 'CANCELLATION_APPROVED' : 'RELOCATION_APPROVED',
          },
        }),
      ).toBe(1);
      expect(
        await db.notification.count({
          where: {
            entityId: r.id,
            userId: f.user.id,
            type: kind === 'cancel' ? 'CANCELLATION_APPROVED' : 'RELOCATION_PROVISIONING',
          },
        }),
      ).toBe(1);
      await request(app.getHttpServer())
        .post(
          `${prefix}/${kind === 'cancel' ? `subscriptions/${f.sub.id}/cancellation/revoke` : `relocations/${r.id}/cancel`}`,
        )
        .auth(f.token, { type: 'bearer' })
        .send({})
        .expect(201);
    },
  );
  it.each(['cancel', 'move'])(
    'allows customer withdrawal before review for %s without changing service or billing',
    async (kind) => {
      const f = await fixture();
      const r = kind === 'cancel' ? await submitCancellation(f) : await submitMove(f);
      await request(app.getHttpServer())
        .post(
          `${prefix}/${kind === 'cancel' ? `subscriptions/${f.sub.id}/cancellation/revoke` : `relocations/${r.id}/cancel`}`,
        )
        .auth(f.token, { type: 'bearer' })
        .send({})
        .expect(201);
      await decision(kind, kind === 'cancel' ? r.requestNumber : r.id, 'approve').expect(409);
      await unchanged(f);
      expect(
        await db.notification.count({
          where: { entityId: r.id, severity: 'ACTION_REQUIRED', isRead: false },
        }),
      ).toBe(0);
    },
  );
  it('keeps requests pending after notifications are read and reports pending queues to all employee roles', async () => {
    const f = await fixture();
    const c = await submitCancellation(f);
    const g = await fixture();
    const move = await submitMove(g);
    for (const employee of employees) {
      const notification = await db.notification.findFirstOrThrow({
        where: { entityId: c.id, userId: employee.id },
      });
      await inApp.markAsRead(notification.id, employee.id);
      const counts = await request(app.getHttpServer())
        .get(`${prefix}/dashboard/service-requests`)
        .auth(employee.token, { type: 'bearer' })
        .expect(200);
      expect(counts.body.cancellations).toBeGreaterThan(0);
      expect(counts.body.relocations).toBeGreaterThan(0);
    }
    expect((await db.cancellationRequest.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'PENDING_REVIEW',
    );
    expect((await db.serviceRelocation.findUniqueOrThrow({ where: { id: move.id } })).status).toBe(
      'PENDING_REVIEW',
    );
    await request(app.getHttpServer())
      .get(`${prefix}/dashboard/service-requests`)
      .auth(f.token, { type: 'bearer' })
      .expect(403);
  });
  it('blocks retry, demo, Super Admin override and late provider-result bypasses on an unapproved move', async () => {
    const f = await fixture();
    const move = await submitMove(f);
    await decision('move', move.id, 'retry-provisioning', employees[1]).expect(409);
    await decision('move', move.id, 'demo-outcome', employees[1], {
      operation: 'PROVISIONING',
      outcome: 'SUCCESS',
      processNow: true,
    }).expect(409);
    await decision('move', move.id, 'override', employees[2], {
      action: 'MARK_NEW_SERVICE_ACTIVE',
      reason: 'Trying to bypass review',
    }).expect(409);
    await (
      relocations as unknown as {
        applyProviderResult: (id: string, result: object) => Promise<void>;
      }
    ).applyProviderResult(move.id, {
      providerReference: 'late-callback',
      status: 'COMPLETED',
      payload: {},
    });
    await unchanged(f);
    expect((await db.serviceRelocation.findUniqueOrThrow({ where: { id: move.id } })).status).toBe(
      'PENDING_REVIEW',
    );
  });
  it('preserves a single approval when an Admin reschedules a pending move concurrently', async () => {
    const f = await fixture();
    const move = await submitMove(f, 15);
    const [approval, schedule] = await Promise.all([
      decision('move', move.id, 'approve', employees[0]),
      request(app.getHttpServer())
        .patch(`${prefix}/relocations/${move.id}/schedule`)
        .auth(employees[1].token, { type: 'bearer' })
        .send({ requestedMoveDate: date(20) }),
    ]);
    expect(approval.status).toBe(201);
    expect(schedule.status).toBe(200);
    const stored = await db.serviceRelocation.findUniqueOrThrow({ where: { id: move.id } });
    expect(stored.reviewDecision).toBe('APPROVED');
    expect(stored.status).toBe('SCHEDULED');
    await unchanged(f);
    await request(app.getHttpServer())
      .post(`${prefix}/relocations/${move.id}/cancel`)
      .auth(f.token, { type: 'bearer' })
      .send({})
      .expect(201);
  });
  it('stores only a refund estimate for a paid recurring cancellation until employee approval reserves the existing prorated refund', async () => {
    const f = await fixture();
    const invoice = await db.invoice.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceNumber: randomUUID().slice(0, 30),
        type: 'STRIPE_RECURRING',
        issueDate: day(-10),
        dueDate: day(-10),
        billingPeriodStart: f.sub.currentPeriodStart,
        billingPeriodEnd: f.sub.currentPeriodEnd,
        subtotalCents: 7264,
        taxCents: 726,
        totalCents: 7990,
        status: 'PAID',
        paidAt: day(-10),
      },
    });
    await db.payment.create({
      data: {
        invoiceId: invoice.id,
        customerId: f.customer.id,
        amountCents: 7990,
        provider: 'STRIPE',
        providerPaymentId: `pi_review_${randomUUID()}`,
        status: 'SUCCEEDED',
        paidAt: day(-10),
      },
    });
    const c = await submitCancellation(f);
    expect(c.status).toBe('PENDING_REVIEW');
    expect(c.refundAmountCents).toBe(0);
    await unchanged(f);
    const stored = await db.cancellationRequest.findUniqueOrThrow({ where: { id: c.id } });
    expect(JSON.stringify(stored.refundCalculation)).toContain('refundAmountCents');
    await decision('cancel', c.requestNumber, 'approve', employees[1]).expect(201);
    const refund = await db.refund.findUniqueOrThrow({ where: { cancellationRequestId: c.id } });
    expect(refund.status).toBe('APPROVED');
    expect(refund.refundAmountCents).toBeGreaterThan(0);
    expect(refund.processedAt).toBeNull();
  });
});
