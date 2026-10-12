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
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
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
    for (const role of [Role.ADMIN, Role.SUPER_ADMIN, Role.STAFF]) {
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
      const summary = await collections.customerSummary({
        id: f.user.id,
        email: f.user.email,
        role: Role.CUSTOMER,
      });
      expect(summary.collectionStage).toBe(stages[day]);
      if (day > 0 && day < 7) expect(summary.suspensionDate).toBe(at(7).toISOString());
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
    for (const [action, day] of [
      ['FIRST_REMINDER_SENT', 1],
      ['SECOND_REMINDER_SENT', 3],
      ['FINAL_WARNING_SENT', 5],
    ] as const) {
      expect(history.find((h) => h.action === action)?.notificationDeliveredAt).toEqual(at(day));
    }
    const notices = await db.notification.findMany({
      where: { userId: f.user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(notices.map((notice) => [notice.title, notice.severity])).toEqual([
      ['Payment overdue', 'WARNING'],
      ['Payment required — invoice still overdue', 'WARNING'],
      ['Final notice — service suspension approaching', 'CRITICAL'],
      ['Service suspended', 'CRITICAL'],
    ]);
    expect(notices[2].message).toContain('scheduled for suspension on 8 October 2026');
    expect(notices[3].message).toContain('balance of $79.90 remains unpaid');
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
  it('uses the highest unpaid stage across invoices for the dashboard action', async () => {
    const f = await fixture();
    await tick(1);
    const urgent = await db.invoice.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceNumber: randomUUID().slice(0, 30),
        issueDate: at(1),
        dueDate: at(1),
        totalCents: 2000,
        subtotalCents: 2000,
        taxCents: 0,
        status: 'OVERDUE',
        collectionStage: 'SECOND_REMINDER',
        firstReminderSentAt: at(2),
        secondReminderSentAt: at(4),
      },
    });
    jest.setSystemTime(at(4));
    expect(
      await collections.customerSummary({
        id: f.user.id,
        email: f.user.email,
        role: Role.CUSTOMER,
      }),
    ).toMatchObject({
      collectionStage: 'SECOND_REMINDER',
      invoiceId: urgent.id,
      overdueCents: 9990,
    });
    await db.invoice.update({
      where: { id: urgent.id },
      data: { status: 'PAID', collectionStage: 'RESOLVED' },
    });
    expect(
      await collections.customerSummary({
        id: f.user.id,
        email: f.user.email,
        role: Role.CUSTOMER,
      }),
    ).toMatchObject({
      collectionStage: 'FIRST_REMINDER',
      invoiceId: f.invoice.id,
      overdueCents: 7990,
    });
  });
  it('does not suspend after payment on day 6', async () => {
    const f = await fixture();
    await warn();
    await pay(f.invoice.id);
    await tick(7);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe('RESOLVED');
    expect(
      await collections.customerSummary({
        id: f.user.id,
        email: f.user.email,
        role: Role.CUSTOMER,
      }),
    ).toMatchObject({ overdueCents: 0, collectionStage: 'NONE', suspensionDate: null });
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'SERVICE_SUSPENDED' } }),
    ).toBe(0);
  });
  it.each([
    [0, 0],
    [2, 1],
    [4, 2],
  ])(
    'stops future warnings when payment resolves the balance on day %i',
    async (paidDay, warningCount) => {
      const f = await fixture();
      for (let day = 0; day <= paidDay; day++) await tick(day);
      await pay(f.invoice.id);
      for (const day of [3, 5, 7]) if (day > paidDay) await tick(day);
      expect(
        await db.notification.count({
          where: {
            userId: f.user.id,
            type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING', 'SERVICE_SUSPENDED'] },
          },
        }),
      ).toBe(warningCount);
      expect(
        (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
      ).toBe(paidDay === 0 ? 'NONE' : 'RESOLVED');
      expect(await status(f.sub.id)).toBe('ACTIVE');
    },
  );
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
    expect(
      await collections.customerSummary({
        id: f.user.id,
        email: f.user.email,
        role: Role.CUSTOMER,
      }),
    ).toMatchObject({
      collectionStage: 'SUSPENSION_SCHEDULED',
      suspensionDate: at(10).toISOString(),
    });
    const extension = await db.notification.findFirstOrThrow({
      where: { userId: f.user.id, type: 'PAYMENT_GRACE_PERIOD_EXTENDED' },
    });
    expect(extension.message).toContain('extended until 11 October 2026');
    expect(extension.message).not.toContain('8 October 2026');
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(3);
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
  it('issues one recovery notice after expiry, preserves 48 hours, and suspends only afterwards', async () => {
    const f = await fixture();
    await tick(20);
    await tick(20);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.firstReminderSentAt).toBeNull();
    expect(invoice.secondReminderSentAt).toBeNull();
    expect(invoice.finalWarningSentAt).toBeNull();
    expect(invoice.originalSuspensionDeadline).toEqual(at(7));
    expect(invoice.recoveryFinalWarningSentAt).toEqual(at(20));
    expect(invoice.recoverySuspensionDeadline).toEqual(at(22));
    expect(await status(f.sub.id)).toBe('ACTIVE');
    const notice = await db.notification.findFirstOrThrow({
      where: { userId: f.user.id, type: 'FINAL_PAYMENT_WARNING' },
    });
    expect(notice).toMatchObject({ title: 'Final payment notice', severity: 'CRITICAL' });
    expect(notice.message).toContain('original payment grace period has ended');
    const summary = await collections.customerSummary({
      id: f.user.id,
      email: f.user.email,
      role: Role.CUSTOMER,
    });
    expect(summary).toMatchObject({
      recoveryFinalWarning: true,
      suspensionDate: at(22).toISOString(),
    });
    const staff = await app.get(SubscriptionsService).findOne(f.sub.id, {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
    });
    expect(staff.gracePeriodEndsAt).toEqual(at(22));
    expect(staff.invoices[0].effectiveSuspensionDeadline).toEqual(staff.gracePeriodEndsAt);
    for (const action of [
      'ORIGINAL_GRACE_EXPIRED',
      'FINAL_WARNING_MISSED',
      'RECOVERY_SAFETY_EXTENSION',
      'RECOVERY_FINAL_WARNING_SENT',
    ])
      expect(await db.auditLog.count({ where: { entityId: f.invoice.id, action } })).toBe(1);
    await tick(21);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } }))
        .recoverySuspensionDeadline,
    ).toEqual(at(22));
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'FINAL_PAYMENT_WARNING' } }),
    ).toBe(1);
    await tick(22);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('catches up at day 4 with one second reminder, then final before the original grace end', async () => {
    const f = await fixture();
    await tick(4);
    await tick(4);
    let invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.firstReminderSentAt).toBeNull();
    expect(invoice.secondReminderSentAt).toEqual(at(4));
    expect(invoice.finalWarningSentAt).toBeNull();
    await tick(5);
    invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.finalWarningSentAt).toEqual(at(5));
    expect(invoice.suspensionScheduledAt).toEqual(at(7));
    await tick(7);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('stops recovery collection after payment and never suspends the settled service', async () => {
    const f = await fixture();
    await tick(10);
    await pay(f.invoice.id);
    await tick(13);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe('RESOLVED');
    expect(
      await db.serviceProvisioningRequest.count({
        where: { subscriptionId: f.sub.id, action: 'SUSPEND' },
      }),
    ).toBe(0);
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'FINAL_PAYMENT_WARNING' } }),
    ).toBe(1);
  });
  it('respects later admin grace during recovery without repeating the final notice or granting another window', async () => {
    const f = await fixture();
    await tick(10);
    const actor = {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
    };
    await lifecycle.extendGracePeriod(f.sub.id, 3, actor, 'Customer needs more time');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).suspensionScheduledAt,
    ).toEqual(at(15));
    await tick(12);
    await tick(14);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      await db.notification.count({ where: { userId: f.user.id, type: 'FINAL_PAYMENT_WARNING' } }),
    ).toBe(1);
    expect(
      (
        await db.notification.findFirstOrThrow({
          where: { userId: f.user.id, type: 'PAYMENT_GRACE_PERIOD_EXTENDED' },
        })
      ).message,
    ).toContain('16 October 2026');
    await tick(15);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } }))
        .recoverySuspensionDeadline,
    ).toEqual(at(12));
  });
  it('moves the unissued final warning relative to an admin extension before final warning', async () => {
    const f = await fixture();
    await tick(1);
    await tick(3);
    await lifecycle.extendGracePeriod(
      f.sub.id,
      3,
      { id: operationalUsers[0].id, email: operationalUsers[0].email, role: Role.ADMIN },
      'Extension before final',
    );
    await tick(5);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).finalWarningSentAt,
    ).toBeNull();
    await tick(8);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).finalWarningSentAt,
    ).toEqual(at(8));
    await tick(10);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('does not regenerate a recovery window after enqueue failure and expired delivery opportunity', async () => {
    const f = await fixture();
    jest.setSystemTime(at(10));
    await collections.markOverdue(at(10));
    emailQueue.enqueue.mockRejectedValueOnce(new Error('Queue temporarily unavailable'));
    await expect(collections.warnings(at(10))).rejects.toThrow('Queue temporarily unavailable');
    let invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.recoverySuspensionDeadline).toEqual(at(12));
    expect(invoice.recoveryFinalWarningSentAt).toBeNull();
    await tick(13);
    await tick(14);
    invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.recoverySuspensionDeadline).toEqual(at(12));
    expect(invoice.recoveryFinalWarningSentAt).toBeNull();
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      await db.serviceProvisioningRequest.count({
        where: { subscriptionId: f.sub.id, action: 'SUSPEND' },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          entityId: f.invoice.id,
          deduplicationKey: `${f.invoice.id}-RECOVERY_DELIVERY_REVIEW`,
        },
      }),
    ).toBe(1);
    await lifecycle.extendGracePeriod(
      f.sub.id,
      3,
      { id: operationalUsers[0].id, email: operationalUsers[0].email, role: Role.ADMIN },
      'Authorize later payment deadline',
    );
    await tick(14);
    invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.recoverySuspensionDeadline).toEqual(at(12));
    expect(invoice.recoveryFinalWarningSentAt).toEqual(at(14));
    expect(invoice.suspensionScheduledAt).toEqual(at(17));
    expect(
      (
        await db.notification.findFirstOrThrow({
          where: { userId: f.user.id, type: 'FINAL_PAYMENT_WARNING' },
        })
      ).message,
    ).toContain('18 October 2026');
    await tick(17);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('blocks recovery suspension while a BECS payment is processing and proceeds only after failure', async () => {
    const f = await fixture();
    await tick(10);
    const payment = await db.payment.create({
      data: {
        customerId: f.customer.id,
        invoiceId: f.invoice.id,
        amountCents: 7990,
        currency: 'AUD',
        status: 'PROCESSING',
        provider: 'STRIPE',
      },
    });
    await tick(12);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await tick(13);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('honors a recovery service safety window across other unpaid invoices and stale provisioning', async () => {
    const f = await fixture();
    await warn();
    jest.setSystemTime(at(7));
    await collections.suspend(at(7));
    const missed = await db.invoice.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceNumber: randomUUID().slice(0, 30),
        issueDate: due,
        dueDate: due,
        totalCents: 2000,
        subtotalCents: 2000,
        taxCents: 0,
        status: 'OVERDUE',
      },
    });
    await tick(8);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    const service = await app.get(SubscriptionsService).findOne(f.sub.id, {
      id: operationalUsers[0].id,
      email: operationalUsers[0].email,
      role: Role.ADMIN,
    });
    expect(service.gracePeriodEndsAt).toEqual(at(10));
    expect(
      service.invoices.every((i) => i.effectiveSuspensionDeadline?.getTime() === at(10).getTime()),
    ).toBe(true);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: missed.id } })).recoveryFinalWarningSentAt,
    ).toEqual(at(8));
    await tick(9);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await tick(10);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
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
    await tick(3);
    jest.setSystemTime(at(4));
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
    ).toBe('SECOND_REMINDER');
    await tick(5);
    const current = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(current.finalWarningSentAt).toEqual(at(5));
    expect(current.suspensionScheduledAt).toEqual(at(7));
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
    for (const user of operationalUsers.slice(0, 2))
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
    await collections.releaseHold(
      f.sub.id,
      {
        id: operationalUsers[0].id,
        email: operationalUsers[0].email,
        role: Role.ADMIN,
      },
      true,
    );
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

  const holdActor = () => ({
    id: operationalUsers[0].id,
    email: operationalUsers[0].email,
    role: Role.ADMIN,
  });
  async function overdue() {
    jest.setSystemTime(at(1));
    await collections.markOverdue(at(1));
  }
  it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'TERMINATED'] as const)(
    'creates and updates one hold for %s debt without changing service state',
    async (statusValue) => {
      const f = await fixture();
      await overdue();
      await db.subscription.update({ where: { id: f.sub.id }, data: { status: statusValue } });
      await Promise.all([
        collections.setHold(f.sub.id, 'Billing dispute', holdActor(), {
          notes: 'Internal investigation',
          holdUntil: at(12).toISOString(),
        }),
        collections.setHold(f.sub.id, 'Billing dispute', holdActor(), {
          notes: 'Internal investigation',
          holdUntil: at(12).toISOString(),
        }),
      ]);
      expect(await status(f.sub.id)).toBe(statusValue);
      expect(
        await db.auditLog.count({
          where: { entityId: f.sub.id, action: 'COLLECTION_HOLD_CREATED' },
        }),
      ).toBe(1);
      const held = await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } });
      expect(held.collectionHoldCreatedBy).toBe(holdActor().id);
      await collections.setHold(f.sub.id, 'Billing dispute', holdActor(), {
        notes: 'Investigation updated',
        holdUntil: at(13).toISOString(),
      });
      expect(
        await db.auditLog.count({
          where: { entityId: f.sub.id, action: 'COLLECTION_HOLD_UPDATED' },
        }),
      ).toBe(1);
      const own = await app
        .get(SubscriptionsService)
        .findOne(f.sub.id, { id: f.user.id, email: f.user.email, role: Role.CUSTOMER });
      expect(JSON.stringify(own)).not.toContain('Investigation updated');
      expect(own.collectionHold).toMatchObject({
        active: true,
        canPlace: false,
        canUpdate: false,
        status: 'ON_HOLD',
      });
    },
  );
  it('rejects missing cases, paid, resolved and pending debt, and reports pending inconsistencies', async () => {
    for (const mode of ['no-case', 'paid', 'resolved', 'pending', 'cancelled-zero']) {
      const f = await fixture();
      await overdue();
      if (mode === 'no-case')
        await db.invoice.update({ where: { id: f.invoice.id }, data: { status: 'CANCELLED' } });
      if (mode === 'paid') await pay(f.invoice.id);
      if (mode === 'resolved')
        await db.invoice.update({
          where: { id: f.invoice.id },
          data: { collectionStage: CollectionStage.RESOLVED },
        });
      if (mode === 'pending')
        await db.subscription.update({ where: { id: f.sub.id }, data: { status: 'PENDING' } });
      if (mode === 'cancelled-zero') {
        await db.subscription.update({ where: { id: f.sub.id }, data: { status: 'CANCELLED' } });
        await pay(f.invoice.id);
      }
      await expect(collections.setHold(f.sub.id, 'Billing dispute', holdActor())).rejects.toThrow(
        /Collection/,
      );
      expect(
        (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })).collectionHoldReason,
      ).toBeNull();
      if (mode === 'pending')
        expect(
          await db.auditLog.count({
            where: { entityId: f.sub.id, action: 'COLLECTION_DATA_REVIEW_REQUIRED' },
          }),
        ).toBe(1);
    }
  });
  it('pauses reminders and final warnings, then expires into the existing fixed recovery window', async () => {
    const f = await fixture();
    await overdue();
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor(), {
      holdUntil: at(10).toISOString(),
    });
    await tick(1);
    await tick(3);
    await tick(5);
    await tick(7);
    await tick(9);
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(0);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status).toBe(
      'OVERDUE',
    );
    await tick(10);
    const recovered = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(recovered.finalWarningSentAt).toBeNull();
    expect(recovered.recoveryFinalWarningSentAt).toEqual(at(10));
    expect(recovered.recoverySuspensionDeadline).toEqual(at(12));
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: f.sub.id, action: 'COLLECTION_HOLD_EXPIRED', actorUserId: null },
      }),
    ).toBe(1);
    await tick(11);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } }))
        .recoverySuspensionDeadline,
    ).toEqual(at(12));
    await tick(12);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
  });
  it('requires release confirmation and waits for the scheduler to safely resume', async () => {
    const f = await fixture();
    await overdue();
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    await tick(10);
    await expect(collections.releaseHold(f.sub.id, holdActor(), false)).rejects.toThrow(/Confirm/);
    await collections.releaseHold(f.sub.id, holdActor(), true);
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(0);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    await tick(10);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } }))
        .recoverySuspensionDeadline,
    ).toEqual(at(12));
    expect(
      await db.auditLog.count({
        where: {
          entityId: f.sub.id,
          action: 'COLLECTION_HOLD_RELEASED',
          actorUserId: holdActor().id,
        },
      }),
    ).toBe(1);
  });
  it('clears a paid hold immediately and rejects a stale form after payment', async () => {
    const f = await fixture();
    await overdue();
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    await pay(f.invoice.id);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })).collectionHoldReason,
    ).toBeNull();
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe(CollectionStage.RESOLVED);
    await expect(collections.setHold(f.sub.id, 'Stale dispute', holdActor())).rejects.toThrow(
      /Collection/,
    );
    await tick(10);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      await db.notification.count({
        where: { userId: f.user.id, type: { in: ['PAYMENT_REMINDER', 'FINAL_PAYMENT_WARNING'] } },
      }),
    ).toBe(0);
  });
  async function credit(f: Awaited<ReturnType<typeof fixture>>, amount: number) {
    return db.accountTransaction.create({
      data: {
        customerId: f.customer.id,
        subscriptionId: f.sub.id,
        invoiceId: f.invoice.id,
        type: 'CREDIT',
        reason: 'BILLING_CORRECTION',
        creditClassification: 'SERVICE_ONLY',
        status: 'AVAILABLE',
        amountCents: amount,
        remainingAmountCents: amount,
        description: 'Approved correction',
        stripeSyncStatus: 'NOT_REQUIRED',
      },
    });
  }
  it('previews approved credits, rechecks them on save and resolves a held balance through the ledger', async () => {
    const f = await fixture();
    await overdue();
    await credit(f, 2000);
    const service = app.get(SubscriptionsService);
    expect((await service.findOne(f.sub.id, holdActor())).collectionHold).toMatchObject({
      canPlace: true,
      collectibleCents: 5990,
    });
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    expect((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).totalCents).toBe(
      5990,
    );
    await credit(f, 5990);
    expect((await service.findOne(f.sub.id, holdActor())).collectionHold).toMatchObject({
      canPlace: false,
      active: false,
      status: 'RESOLVED',
    });
    await tick(2);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })).collectionHoldReason,
    ).toBeNull();
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe(CollectionStage.RESOLVED);
    await expect(collections.setHold(f.sub.id, 'No debt', holdActor())).rejects.toThrow(
      /Collection/,
    );
  });

  it('retains an unaccepted warning while held and resumes only the current warning', async () => {
    const f = await fixture();
    jest.setSystemTime(at(1));
    await collections.markOverdue(at(1));
    emailQueue.enqueue.mockRejectedValueOnce(new Error('Queue offline'));
    await expect(collections.warnings(at(1))).rejects.toThrow('Queue offline');
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    await collections.deliver(at(1));
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).firstReminderSentAt,
    ).toBeNull();
    await tick(9);
    await collections.releaseHold(f.sub.id, holdActor(), true);
    await tick(9);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } });
    expect(invoice.firstReminderSentAt).toBeNull();
    expect(invoice.secondReminderSentAt).toBeNull();
    expect(invoice.recoveryFinalWarningSentAt).toEqual(at(9));
  });
  it('does not restore a suspended service on hold creation but preserves restoration after settlement', async () => {
    const f = await fixture();
    await warn();
    await tick(7);
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    expect(await status(f.sub.id)).toBe('SUSPENDED');
    expect(
      await db.serviceProvisioningRequest.count({
        where: { subscriptionId: f.sub.id, action: 'RESTORE' },
      }),
    ).toBe(0);
    await pay(f.invoice.id);
    expect(await status(f.sub.id)).toBe('ACTIVE');
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })).collectionHoldReason,
    ).toBeNull();
    expect(
      await db.serviceProvisioningRequest.count({
        where: { subscriptionId: f.sub.id, action: 'RESTORE' },
      }),
    ).toBe(1);
  });

  it('resolves a zero-credit balance after release even if no reminder was ever issued', async () => {
    const f = await fixture();
    await overdue();
    await collections.setHold(f.sub.id, 'Billing dispute', holdActor());
    await credit(f, 7990);
    await collections.releaseHold(f.sub.id, holdActor(), true);
    await tick(2);
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).collectionStage,
    ).toBe(CollectionStage.RESOLVED);
    expect(
      (await app.get(SubscriptionsService).findOne(f.sub.id, holdActor())).collectionHold.status,
    ).toBe('RESOLVED');
  });
  it('enforces hold write RBAC on both endpoints and confirmation on the API', async () => {
    const f = await fixture();
    await overdue();
    for (const email of [f.user.email, operationalUsers[2].email]) {
      const bearer = await token(email);
      await request(app.getHttpServer())
        .put(`/api/v1/collections/subscriptions/${f.sub.id}/hold`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ reason: 'Billing dispute' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/collections/subscriptions/${f.sub.id}/hold/release`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ confirmed: true })
        .expect(403);
    }
    for (const admin of operationalUsers.slice(0, 2)) {
      const bearer = await token(admin.email);
      await request(app.getHttpServer())
        .put(`/api/v1/collections/subscriptions/${f.sub.id}/hold`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ reason: 'Billing dispute', notes: 'Private staff notes' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/collections/subscriptions/${f.sub.id}/hold/release`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/collections/subscriptions/${f.sub.id}/hold/release`)
        .set('Authorization', `Bearer ${bearer}`)
        .send({ confirmed: true })
        .expect(201);
    }
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
