import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CollectionStage, Role, SuspensionReason } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import configuration, { type AppConfig } from '../src/config/configuration';
import { validationSchema } from '../src/config/env.validation';
import { configureApplication } from '../src/configure-application';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { CacheModule } from '../src/modules/cache/cache.module';
import { SubscriptionsModule } from '../src/modules/subscriptions/subscriptions.module';
import { CollectionService } from '../src/modules/subscriptions/collection.service';
import { CollectionPolicyService } from '../src/modules/subscriptions/collection-policy.service';
import { ProvisioningService } from '../src/modules/subscriptions/provisioning.service';
import { SubscriptionLifecycleService } from '../src/modules/subscriptions/subscription-lifecycle.service';
import { OverdueLifecycleSchedulerService } from '../src/modules/subscriptions/overdue-lifecycle-scheduler.service';
import { EmailQueueService } from '../src/modules/notifications/email-queue.service';
import { EmailProvider } from '../src/modules/notifications/email-provider';
import { NotificationService } from '../src/modules/notifications/notification.service';

const due = new Date('2026-10-01T00:00:00Z');
const at = (day: number) => new Date(due.getTime() + day * 86_400_000);
describe('Overdue collection with PostgreSQL and central notifications (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let collections: CollectionService;
  let provisioning: ProvisioningService;
  let lifecycle: SubscriptionLifecycleService;
  let policy: CollectionPolicyService;
  let passwordHash: string;
  const customerIds: string[] = [];
  const userIds: string[] = [];
  const emails = new Set<string>();
  const emailQueue = {
    enqueue: jest.fn(async (_message: unknown, _context: unknown, key: string) => {
      emails.add(key);
      return { jobId: key, recipient: 'customer@collection.test' };
    }),
  };
  let operationalUsers: Array<{ id: string; email: string }>;

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
        SubscriptionsModule,
      ],
    })
      .overrideProvider(OverdueLifecycleSchedulerService)
      .useValue({})
      .overrideProvider(EmailQueueService)
      .useValue(emailQueue)
      .overrideProvider(EmailProvider)
      .useValue({ send: jest.fn() })
      .compile();
    app = module.createNestApplication();
    configureApplication(app, { logger: false, swagger: false });
    await app.init();
    db = app.get(PrismaService);
    collections = app.get(CollectionService);
    provisioning = app.get(ProvisioningService);
    lifecycle = app.get(SubscriptionLifecycleService);
    policy = app.get(CollectionPolicyService);
    passwordHash = await hash('CollectionPassword1!', 4);
    operationalUsers = [];
    for (const role of [Role.ADMIN, Role.SUPER_ADMIN]) {
      const user = await db.user.create({
        data: {
          email: `${randomUUID()}@collection.test`,
          passwordHash,
          roles: { create: { role } },
        },
      });
      userIds.push(user.id);
      operationalUsers.push(user);
    }
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'hrtime',
        'performance',
      ],
    });
    jest.setSystemTime(due);
  });
  afterAll(async () => {
    jest.useRealTimers();
    if (db) {
      const invoices = await db.invoice.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      });
      await db.creditApplication.deleteMany({
        where: { invoiceId: { in: invoices.map((i) => i.id) } },
      });
      await db.accountTransaction.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.serviceProvisioningRequest.deleteMany({
        where: { subscription: { customerId: { in: customerIds } } },
      });
      await db.payment.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.cancellationRequest.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.serviceRelocation.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.subscription.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
      await db.customer.deleteMany({ where: { id: { in: customerIds } } });
      await db.auditLog.deleteMany({
        where: {
          OR: [{ actorUserId: { in: userIds } }, { entityId: { in: invoices.map((i) => i.id) } }],
        },
      });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.collectionPolicy.deleteMany({ where: { id: 'default' } });
    }
    await app?.close();
  });
  async function fixture() {
    jest.setSystemTime(due);
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@collection.test`,
        passwordHash,
        roles: { create: { role: Role.CUSTOMER } },
      },
    });
    userIds.push(user.id);
    const customer = await db.customer.create({
      data: {
        userId: user.id,
        customerNumber: randomUUID().slice(0, 20),
        firstName: 'Collection',
        lastName: 'Customer',
        email: user.email,
        phone: '0400000000',
        addressLine1: '1 Test Road',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    });
    customerIds.push(customer.id);
    const plan = await db.internetPlan.upsert({
      where: { name: 'Collection test plan' },
      create: {
        name: 'Collection test plan',
        monthlyCents: 7990,
        downloadMbps: 100,
        uploadMbps: 20,
      },
      update: {},
    });
    const sub = await db.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        monthlyCents: 7990,
        status: 'ACTIVE',
        startDate: due,
        currentPeriodStart: due,
        currentPeriodEnd: at(31),
        billingAnchorDay: 1,
      },
    });
    const invoice = await db.invoice.create({
      data: {
        customerId: customer.id,
        subscriptionId: sub.id,
        invoiceNumber: randomUUID().slice(0, 30),
        issueDate: due,
        dueDate: due,
        totalCents: 7990,
        subtotalCents: 7264,
        taxCents: 726,
        status: 'ISSUED',
      },
    });
    return { user, customer, sub, invoice };
  }
  async function tick(day: number) {
    jest.setSystemTime(at(day));
    await collections.markOverdue(at(day));
    await collections.warnings(at(day));
    await collections.suspend(at(day));
    await provisioning.reconcilePending(100);
    await collections.deliver(at(day));
  }
  async function warn() {
    await tick(1);
    await tick(3);
    await tick(5);
    await tick(6);
  }
  async function pay(invoiceId: string) {
    await db.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await lifecycle.handleConfirmedPayment(invoiceId);
  }
  async function status(id: string) {
    return (await db.subscription.findUniqueOrThrow({ where: { id } })).status;
  }
  async function token(email: string) {
    const result = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ email, password: 'CollectionPassword1!' })
      .expect(200);
    return String(result.body.accessToken);
  }

  it('sends exactly three warnings on days 1/3/5, suspends on day 7, restores only once after payment', async () => {
    const f = await fixture();
    const stages = [
      CollectionStage.NONE,
      CollectionStage.FIRST_REMINDER,
      CollectionStage.FIRST_REMINDER,
      CollectionStage.SECOND_REMINDER,
      CollectionStage.SECOND_REMINDER,
      CollectionStage.SUSPENSION_SCHEDULED,
      CollectionStage.SUSPENSION_SCHEDULED,
      CollectionStage.SUSPENDED,
    ];
    for (let day = 0; day <= 7; day++) {
      await tick(day);
      await tick(day);
      expect(
        (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
      ).toBe(stages[day]);
      expect(await status(f.sub.id)).toBe(day === 7 ? 'SUSPENDED' : 'ACTIVE');
    }
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(3);
    expect(
      await db.notification.count({ where: { userId: { in: operationalUsers.map((u) => u.id) } } }),
    ).toBe(0);
    const history = await collections.history(f.sub.id);
    expect(history.some((h) => h.action === 'SUSPENSION_SCHEDULED')).toBe(true);
    const emailCount = emails.size;
    await pay(f.invoice.id);
    await pay(f.invoice.id);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(emails.size).toBe(emailCount + 1);
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'SERVICE_RESTORED' } }),
    ).toBe(1);
    expect(await db.serviceProvisioningRequest.count({ where: { subscriptionId: f.sub.id } })).toBe(
      2,
    );
  });
  it('does not suspend after payment on day 6', async () => {
    const f = await fixture();
    await warn();
    await pay(f.invoice.id);
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
  });
  it('honors an audited grace extension until day 10', async () => {
    const f = await fixture();
    await warn();
    const admin = {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
      roles: [Role.ADMIN],
    };
    await lifecycle.extendGracePeriod(f.sub.id, 3, admin, 'Customer requested more payment time');
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await tick(10);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: 'PAYMENT_GRACE_PERIOD_EXTENDED' },
      }),
    ).toBe(1);
  });
  it('blocks pending direct debit and partial payments', async () => {
    const f = await fixture();
    await warn();
    const payment = await db.payment.create({
      data: {
        invoiceId: f.invoice.id,
        customerId: f.customer.id,
        provider: 'STRIPE',
        amountCents: 4000,
        status: 'PROCESSING',
        paymentMethodType: 'AU_BECS_DEBIT',
      },
    });
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await db.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
    await tick(8);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    await collections.confirmedPayment(f.invoice.id);
    await provisioning.reconcilePending(100);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('requires all due invoices to be cleared before restoration', async () => {
    const f = await fixture();
    await warn();
    await tick(7);
    const second = await db.invoice.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceNumber: randomUUID().slice(0, 30),
        issueDate: due,
        dueDate: at(1),
        totalCents: 7990,
        subtotalCents: 7264,
        taxCents: 726,
        status: 'OVERDUE',
      },
    });
    await pay(f.invoice.id);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    await pay(second.id);
    expect(await status(f.sub.id)).toBe('ACTIVE');
  });
  it('applies a real approved ledger credit and stops collection', async () => {
    const f = await fixture();
    await tick(1);
    await db.accountTransaction.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceId: f.invoice.id,
        type: 'CREDIT',
        creditClassification: 'SERVICE_ONLY',
        reason: 'BILLING_CORRECTION',
        status: 'AVAILABLE',
        amountCents: 7990,
        remainingAmountCents: 7990,
        currency: 'AUD',
        description: 'Approved correction',
        stripeSyncStatus: 'NOT_REQUIRED',
      },
    });
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status).toBe(
      'PAID',
    );
  });
  it('never restores a manual or fraud suspension after payment', async () => {
    for (const reason of [SuspensionReason.ADMINISTRATIVE, SuspensionReason.FRAUD]) {
      const f = await fixture();
      await db.subscription.update({
        where: { id: f.sub.id },
        data: { status: 'SUSPENDED', suspensionReason: reason },
      });
      await pay(f.invoice.id);
      expect(await status(f.sub.id)).toBe('SUSPENDED');
    }
  });
  it('does not collapse missed warnings into immediate suspension', async () => {
    const f = await fixture();
    await tick(20);
    await tick(20);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).secondReminderSentAt,
    ).toBeNull();
  });
  it('rechecks payment after suspension intent and suppresses stale provisioning', async () => {
    const f = await fixture();
    await warn();
    jest.setSystemTime(at(7));
    await collections.suspend(at(7));
    await pay(f.invoice.id);
    await provisioning.reconcilePending(100);
    expect(await status(f.sub.id)).toBe('ACTIVE');
  });
  it('deduplicates concurrent scheduler warning creation and deliveries', async () => {
    const f = await fixture();
    jest.setSystemTime(at(1));
    await collections.markOverdue(at(1));
    await Promise.all([collections.warnings(at(1)), collections.warnings(at(1))]);
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'PAYMENT_REMINDER' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: f.invoice.id, action: 'FIRST_REMINDER_SENT' } }),
    ).toBe(1);
  });
  it('preserves manual reminders without advancing the automated stage', async () => {
    const f = await fixture();
    await tick(1);
    await collections.manualReminder(
      f.invoice.id,
      { id: operationalUsers[0].id, email: operationalUsers[0].email, role: Role.ADMIN },
      'manual-retry',
    );
    await collections.manualReminder(
      f.invoice.id,
      { id: operationalUsers[0].id, email: operationalUsers[0].email, role: Role.ADMIN },
      'manual-retry',
    );
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe('FIRST_REMINDER');
    expect(
      await db.auditLog.count({
        where: { entityId: f.invoice.id, action: 'MANUAL_PAYMENT_REMINDER_SENT' },
      }),
    ).toBe(1);
  });
  it('keeps failures truthful and alerts Admin and Super Admin once per operation', async () => {
    const f = await fixture();
    await warn();
    jest.setSystemTime(at(7));
    await collections.suspend(at(7));
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    const failureConfig = new ConfigService<AppConfig, true>({
      ...configuration(),
      overdueLifecycle: {
        ...config.getOrThrow('overdueLifecycle'),
        provisioningMockResult: 'FAILED',
      },
    });
    const failed = new ProvisioningService(db, failureConfig, app.get(NotificationService), policy);
    await failed.reconcilePending(100);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    for (const user of operationalUsers)
      expect(
        await db.notification.count({
          where: {
            userId: user.id,
            type: 'SERVICE_STATE_CHANGE_FAILED',
            severity: 'ACTION_REQUIRED',
          },
        }),
      ).toBeGreaterThan(0);
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'SERVICE_SUSPENDED' } }),
    ).toBe(0);
    await provisioning.reconcilePending(100);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    await db.invoice.update({
      where: { id: f.invoice.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await collections.confirmedPayment(f.invoice.id);
    await failed.reconcilePending(100);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    expect(
      await db.notification.count({ where: { userId: f.user.id, title: 'Payment received' } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'SERVICE_RESTORED' } }),
    ).toBe(0);
    await provisioning.reconcilePending(100);
    await collections.deliver();
    expect(await status(f.sub.id)).toBe('ACTIVE');
  });
  it('respects collection holds and cancellation, including permanently inactive services', async () => {
    for (const state of ['CANCELLED', 'TERMINATED', 'CANCELLATION_PENDING'] as const) {
      const f = await fixture();
      await warn();
      await db.subscription.update({ where: { id: f.sub.id }, data: { status: state } });
      await tick(7);
      expect(await status(f.sub.id)).toBe(state);
    }
    const f = await fixture();
    await warn();
    await collections.setHold(f.sub.id, 'Approved exemption', {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
    });
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await collections.setHold(f.sub.id, '', {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
    });
    await tick(8);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('preserves active relocation and raises a collection review exception', async () => {
    const f = await fixture();
    await warn();
    const address = await db.serviceAddress.create({
      data: {
        customerId: f.customer.id,
        addressLine1: '1 Test Road',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    });
    const relocation = await db.serviceRelocation.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        oldServiceAddressId: address.id,
        newServiceAddressId: address.id,
        currentPlanId: f.sub.planId,
        requestedPlanId: f.sub.planId,
        requestedMoveDate: at(10),
        qualificationStatus: 'AVAILABLE',
        qualification: {},
        providerIdempotencyKey: randomUUID(),
        requestedByUserId: f.user.id,
        status: 'PROVISIONING',
      },
    });
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      (await db.serviceRelocation.findUniqueOrThrow({ where: { id: relocation.id } })).status,
    ).toBe('PROVISIONING');
    const summary = await collections.customerSummary({
      id: f.user.id,
      email: f.user.email,
      role: Role.CUSTOMER,
    });
    expect(summary.suspensionDate).toBeNull();
    expect(summary.paymentProcessing).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entityId: f.invoice.id, action: 'COLLECTION_REVIEW_REQUIRED' },
      }),
    ).toBe(1);
    await db.subscription.update({
      where: { id: f.sub.id },
      data: {
        status: 'SUSPENDED',
        suspensionReason: SuspensionReason.NON_PAYMENT,
        suspendedAt: at(7),
      },
    });
    await pay(f.invoice.id);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    expect(
      (
        await collections.customerSummary({
          id: f.user.id,
          email: f.user.email,
          role: Role.CUSTOMER,
        })
      ).restorationProcessing,
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entityId: f.invoice.id, action: 'COLLECTION_REVIEW_REQUIRED' },
      }),
    ).toBe(2);
  });
  it('enforces the canonical billing-period unique constraint', async () => {
    const f = await fixture();
    await db.invoice.update({
      where: { id: f.invoice.id },
      data: { billingPeriodStart: due, billingPeriodEnd: at(30) },
    });
    await expect(
      db.invoice.create({
        data: {
          customerId: f.customer.id,
          subscriptionId: f.sub.id,
          invoiceNumber: randomUUID().slice(0, 30),
          issueDate: due,
          dueDate: due,
          billingPeriodStart: due,
          billingPeriodEnd: at(30),
          totalCents: 7990,
          taxCents: 726,
          subtotalCents: 7264,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('retains the durable warning intent if the email queue temporarily fails', async () => {
    const f = await fixture();
    jest.setSystemTime(at(1));
    await collections.markOverdue(at(1));
    emailQueue.enqueue.mockRejectedValueOnce(new Error('Queue offline'));
    await expect(collections.warnings(at(1))).rejects.toThrow('Queue offline');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).firstReminderSentAt,
    ).toBeNull();
    await collections.warnings(at(1));
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'PAYMENT_REMINDER' } }),
    ).toBe(1);
  });
  it('server-authorizes policy, reminder, grace, hold, suspension and restoration actions', async () => {
    const f = await fixture();
    await tick(1);
    const customerToken = await token(f.user.email);
    for (const path of [
      `collections/invoices/${f.invoice.id}/remind`,
      `subscriptions/${f.sub.id}/extend-grace-period`,
      `subscriptions/${f.sub.id}/suspend`,
      `subscriptions/${f.sub.id}/reactivate`,
    ])
      await request(app.getHttpServer())
        .post(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ days: 3, reason: 'Test reason', requestKey: 'test' })
        .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/collections/policy')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ firstReminderDays: 1, secondReminderDays: 3, finalWarningDays: 5, suspensionDays: 7 })
      .expect(403);
    const adminToken = await token(operationalUsers[0].email);
    await request(app.getHttpServer())
      .put('/api/v1/collections/policy')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(403);
    const superToken = await token(operationalUsers[1].email);
    await request(app.getHttpServer())
      .put('/api/v1/collections/policy')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ firstReminderDays: 3, secondReminderDays: 1, finalWarningDays: 5, suspensionDays: 7 })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/collections/policy')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ firstReminderDays: 1, secondReminderDays: 3, finalWarningDays: 5, suspensionDays: 7 })
      .expect(200);
    const summary = await request(app.getHttpServer())
      .get('/api/v1/collections/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(summary.body.invoiceId).toBe(f.invoice.id);
  });
});
