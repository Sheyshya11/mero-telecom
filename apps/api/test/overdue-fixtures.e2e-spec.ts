import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import configuration from '../src/config/configuration';
import {
  assertLocalFixtureDatabase,
  seedOverdueCustomers,
  queueOverdueFixtureEmails,
} from '../src/scripts/seed-overdue-customers';
import { nextWarning, RECOVERY_WINDOW_MS } from '../src/modules/subscriptions/collection-deadline';

const prisma = new PrismaClient();
const batch = `qa-${randomUUID().slice(0, 8)}`;
const collisionBatch = `qc-${randomUUID().slice(0, 8)}`;
const reuseBatch = `qr-${randomUUID().slice(0, 8)}`;
const existingNumber = `CUST-EX-${reuseBatch}`;
const now = new Date();
const password = 'ChangeMe123!';
const names = (value: string) =>
  ['SECOND', 'FINAL', 'RECOVERY'].map((key) => `CUST-OD-${value}-${key}`);
let createdPlanId: string | undefined;
let previousClock: string | undefined;

beforeAll(async () => {
  assertLocalFixtureDatabase(process.env.NODE_ENV, process.env.DATABASE_URL ?? '');
  previousClock = process.env.OVERDUE_DEMO_DAY_MS;
  process.env.OVERDUE_DEMO_DAY_MS = '86400000';
  await prisma.$connect();
}, 30_000);

afterAll(async () => {
  try {
    const customers = await prisma.customer.findMany({
      where: {
        customerNumber: {
          in: [...names(batch), ...names(collisionBatch), ...names(reuseBatch), existingNumber],
        },
      },
      select: { id: true, userId: true },
    });
    const ids = customers.map((customer) => customer.id);
    const invoices = await prisma.invoice.findMany({
      where: { customerId: { in: ids } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityType: 'Invoice', entityId: { in: invoices.map((invoice) => invoice.id) } },
    });
    await prisma.payment.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.subscription.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customerAddress.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({
      where: {
        id: { in: customers.flatMap((customer) => (customer.userId ? [customer.userId] : [])) },
      },
    });
    if (
      createdPlanId &&
      (await prisma.subscription.count({ where: { planId: createdPlanId } })) === 0
    ) {
      await prisma.internetPlan.delete({ where: { id: createdPlanId } });
    }
  } finally {
    if (previousClock === undefined) delete process.env.OVERDUE_DEMO_DAY_MS;
    else process.env.OVERDUE_DEMO_DAY_MS = previousClock;
    await prisma.$disconnect();
  }
});

describe('overdue fixture script', () => {
  it('rejects production and remote database targets', () => {
    expect(() => assertLocalFixtureDatabase('production', 'postgresql://localhost/demo')).toThrow();
    expect(() =>
      assertLocalFixtureDatabase('development', 'postgresql://remote.example/demo'),
    ).toThrow();
    expect(() => assertLocalFixtureDatabase('test', 'postgresql://localhost/demo')).not.toThrow();
  });

  it('previews three distinct warning scenarios without writing records', async () => {
    const results = await seedOverdueCustomers(prisma, { batch, password, now, dryRun: true });
    expect(results.map((result) => result.scenario)).toEqual([
      'SECOND_REMINDER',
      'FINAL_WARNING',
      'RECOVERY_FINAL_WARNING',
    ]);
    expect(results.every((result) => result.result === 'would create')).toBe(true);
    expect(await prisma.customer.count({ where: { customerNumber: { in: names(batch) } } })).toBe(
      0,
    );
    expect(
      await prisma.user.count({ where: { email: { in: results.map((result) => result.email) } } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          deduplicationKey: {
            in: ['SECOND', 'FINAL', 'RECOVERY'].map((key) => `overdue-fixture-${batch}-${key}`),
          },
        },
      }),
    ).toBe(0);
  });

  it('creates complete warning history, active manual services and consistent future deadlines', async () => {
    const oldPlan = await prisma.internetPlan.findUnique({
      where: { name: 'Overdue warning fixture plan' },
    });
    const results = await seedOverdueCustomers(prisma, { batch, password, now });
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.result === 'created')).toBe(true);
    const policy = (await prisma.collectionPolicy.findUnique({ where: { id: 'default' } })) ?? {
      firstReminderDays: 1,
      secondReminderDays: 3,
      finalWarningDays: 5,
      suspensionDays: 7,
    };
    for (const [index, result] of results.entries()) {
      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { invoiceNumber: result.invoiceNumber },
        include: {
          subscription: { include: { plan: true } },
          customer: { include: { user: { include: { roles: true, notifications: true } } } },
          items: true,
          payments: true,
        },
      });
      if (!oldPlan) createdPlanId = invoice.subscription!.planId;
      expect(invoice.status).toBe('OVERDUE');
      expect(invoice.totalCents).toBe(7900);
      expect(invoice.items.reduce((sum, item) => sum + item.amountCents, 0)).toBe(7900);
      expect(invoice.payments).toHaveLength(0);
      expect(invoice.subscription!.status).toBe('ACTIVE');
      expect(invoice.subscription!.billingMode).toBe('MANUAL');
      expect(invoice.subscription!.stripeSubscriptionId).toBeNull();
      expect(invoice.subscription!.plan.stripePriceId).toBeNull();
      expect(invoice.subscription!.plan.isPublic).toBe(false);
      expect(invoice.customer.user!.roles.map((role) => role.role)).toEqual(['CUSTOMER']);
      expect(invoice.customer.user!.email).toBe(invoice.customer.email);
      expect(invoice.customer.user!.passwordHash).toBeTruthy();
      expect(invoice.customer.user!.notifications).toHaveLength(index === 0 ? 2 : 3);
      expect(
        invoice.customer.user!.notifications.every(
          (notification) => (notification.metadata as { simulated: boolean }).simulated,
        ),
      ).toBe(true);
      expect(invoice.subscription!.gracePeriodEndsAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(invoice.originalSuspensionDeadline!.getTime()).toBe(
        invoice.dueDate.getTime() + policy.suspensionDays * 86_400_000,
      );
      expect(nextWarning(invoice, now, policy, 86_400_000)).toBeNull();
      if (index === 0) {
        expect(invoice.collectionStage).toBe('SECOND_REMINDER');
        expect(invoice.secondReminderSentAt).not.toBeNull();
        expect(invoice.finalWarningSentAt).toBeNull();
      } else {
        expect(invoice.collectionStage).toBe('SUSPENSION_SCHEDULED');
        expect(invoice.subscription!.gracePeriodEndsAt).toEqual(invoice.suspensionScheduledAt);
      }
      if (index === 2) {
        expect(invoice.finalWarningSentAt).toBeNull();
        expect(invoice.originalSuspensionDeadline!.getTime()).toBeLessThan(now.getTime());
        expect(invoice.recoveryFinalWarningSentAt).toEqual(now);
        expect(invoice.recoverySuspensionDeadline!.getTime() - now.getTime()).toBe(
          RECOVERY_WINDOW_MS,
        );
      } else {
        expect(invoice.recoveryFinalWarningSentAt).toBeNull();
        expect(invoice.recoverySuspensionDeadline).toBeNull();
        if (index === 1) expect(invoice.finalWarningSentAt).not.toBeNull();
      }
      const notices = await prisma.auditLog.findMany({
        where: { entityId: invoice.id, notificationEvent: { not: null } },
      });
      expect(
        notices.every(
          (entry) =>
            entry.notificationDeliveredAt !== null &&
            (entry.metadata as { emailSent: boolean }).emailSent === false,
        ),
      ).toBe(true);
      expect(
        await prisma.serviceProvisioningRequest.count({
          where: { subscriptionId: invoice.subscriptionId! },
        }),
      ).toBe(0);
    }
  }, 30_000);

  it('queues one current alert per fixture, retries queue rejection and prevents rerun duplicates', async () => {
    const fixtures = await seedOverdueCustomers(prisma, { batch, password, now });
    const configured = configuration();
    const settings = {
      ...configured,
      email: { ...configured.email, deliveryMode: 'direct' as const },
    };
    const queue = { enqueue: jest.fn().mockRejectedValueOnce(new Error('Queue unavailable')) };
    await expect(queueOverdueFixtureEmails(prisma, queue, fixtures, settings)).rejects.toThrow(
      'Queue unavailable',
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'DEMO_OVERDUE_EMAIL_QUEUED', entityId: fixtures[0].invoiceId },
      }),
    ).toBe(0);
    queue.enqueue.mockImplementation(async (message, _context, jobId) => ({
      jobId,
      recipient: message.to,
    }));
    const deliveries = await queueOverdueFixtureEmails(prisma, queue, fixtures, settings);
    expect(deliveries.map((delivery) => delivery.status)).toEqual(['queued', 'queued', 'queued']);
    const calls = queue.enqueue.mock.calls.slice(1);
    expect(calls.map(([message]) => message.to)).toEqual(fixtures.map((fixture) => fixture.email));
    expect(calls.map(([, context]) => context.purpose)).toEqual([
      'SECOND_REMINDER',
      'FINAL_WARNING',
      'RECOVERY_FINAL_WARNING',
    ]);
    for (const [index, [message, context, jobId]] of calls.entries()) {
      expect(context.invoiceId).toBe(fixtures[index].invoiceId);
      expect(context.subscriptionId).toBe(fixtures[index].subscriptionId);
      expect(message.html).toContain(fixtures[index].invoiceNumber);
      expect(jobId).toBe(
        `seed-overdue-${fixtures[index].invoiceId}-${fixtures[index].scenario.toLowerCase()}`,
      );
      expect(
        await prisma.notification.count({ where: { entityId: fixtures[index].invoiceId } }),
      ).toBe(index === 0 ? 2 : 3);
      const marker = await prisma.auditLog.findUniqueOrThrow({
        where: {
          deduplicationKey: `${fixtures[index].invoiceId}-SEED_EMAIL-${fixtures[index].scenario}`,
        },
      });
      expect(marker.metadata).toMatchObject({
        recipient: fixtures[index].email,
        jobId,
        emailSent: false,
      });
    }
    const repeated = await queueOverdueFixtureEmails(prisma, queue, fixtures, settings);
    expect(repeated.map((delivery) => delivery.status)).toEqual([
      'already queued',
      'already queued',
      'already queued',
    ]);
    expect(queue.enqueue).toHaveBeenCalledTimes(4);
  });

  it('reruns preserve customer changes, paid state and deadlines without duplicate history', async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { invoiceNumber: `INV-OD-${batch}-SECOND` },
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: now, collectionStage: 'RESOLVED' },
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: invoice.customerId } });
    const changedEmail = `changed-${batch}@merotelecom.test`;
    await prisma.$transaction([
      prisma.customer.update({ where: { id: customer.id }, data: { email: changedEmail } }),
      prisma.user.update({ where: { id: customer.userId! }, data: { email: changedEmail } }),
    ]);
    const noticesBefore = await prisma.notification.count({ where: { userId: customer.userId! } });
    const results = await seedOverdueCustomers(prisma, {
      batch,
      password,
      now: new Date(now.getTime() + 86_400_000),
    });
    expect(results.every((result) => result.result === 'existing')).toBe(true);
    expect(results[0].email).toBe(changedEmail);
    expect(results[0].stage).toBe('RESOLVED');
    expect(await prisma.customer.count({ where: { customerNumber: { in: names(batch) } } })).toBe(
      3,
    );
    expect(await prisma.notification.count({ where: { userId: customer.userId! } })).toBe(
      noticesBefore,
    );
    const preserved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(preserved.status).toBe('PAID');
    expect(preserved.originalSuspensionDeadline).toEqual(invoice.originalSuspensionDeadline);
    const queue = { enqueue: jest.fn() };
    const emailResults = await queueOverdueFixtureEmails(prisma, queue, results);
    expect(emailResults[0].status).toBe('skipped');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rolls back the entire batch when a later identity belongs to an existing customer', async () => {
    await prisma.customer.create({
      data: {
        customerNumber: `CUST-OD-${collisionBatch}-RECOVERY`,
        firstName: 'Existing',
        lastName: 'Unchanged',
        email: `collision-${collisionBatch}@merotelecom.test`,
        phone: '0400000099',
        addressLine1: '15 King William Street',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    });
    await expect(
      seedOverdueCustomers(prisma, { batch: collisionBatch, password, now }),
    ).rejects.toThrow('collision');
    expect(
      await prisma.customer.count({ where: { customerNumber: { in: names(collisionBatch) } } }),
    ).toBe(1);
    expect(
      await prisma.user.count({
        where: {
          email: {
            in: ['second', 'final', 'recovery'].map(
              (key) => `overdue-${collisionBatch}-${key}@merotelecom.test`,
            ),
          },
        },
      }),
    ).toBe(0);
  });
  it('adds a final-warning invoice to the existing customer while preserving recurring billing, credentials and paid history', async () => {
    const existingEmail = `existing-${reuseBatch}@merotelecom.test`;
    const passwordHash = await hash('OriginalCustomerPassword!', 4);
    const user = await prisma.user.create({
      data: {
        email: existingEmail,
        passwordHash,
        roles: { create: { role: 'CUSTOMER' } },
        emailVerifiedAt: now,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        customerNumber: existingNumber,
        email: existingEmail,
        firstName: 'Existing',
        lastName: 'Customer',
        phone: '0400000099',
        addressLine1: '15 King William Street',
        suburb: 'Adelaide',
        state: 'SA',
        postcode: '5000',
      },
    });
    const plan = await prisma.internetPlan.findUniqueOrThrow({
      where: { name: 'Overdue warning fixture plan' },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        monthlyCents: 7900,
        status: 'ACTIVE',
        billingMode: 'STRIPE_RECURRING',
        stripeSubscriptionId: `sub_fixture_${reuseBatch}`,
        stripePriceId: `price_fixture_${reuseBatch}`,
        stripePaymentMethodId: `pm_fixture_${reuseBatch}`,
        stripeStatus: 'active',
        startDate: now,
        billingAnchorDay: 8,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
    const paid = await prisma.invoice.create({
      data: {
        customerId: customer.id,
        subscriptionId: subscription.id,
        invoiceNumber: `INV-PAID-${reuseBatch}`,
        type: 'STRIPE_RECURRING',
        stripeInvoiceId: `in_fixture_${reuseBatch}`,
        status: 'PAID',
        issueDate: now,
        issuedAt: now,
        dueDate: new Date(now.getTime() + 14 * 86_400_000),
        subtotalCents: 7182,
        taxCents: 718,
        totalCents: 7900,
        paidAt: now,
        payments: {
          create: {
            customerId: customer.id,
            provider: 'STRIPE',
            providerPaymentId: `pi_fixture_${reuseBatch}`,
            amountCents: 7900,
            status: 'SUCCEEDED',
            paidAt: now,
          },
        },
      },
    });
    const options = {
      batch: reuseBatch,
      password,
      now,
      reuseExistingFinal: true,
      emails: { FINAL: existingEmail },
    };
    const preview = await seedOverdueCustomers(prisma, { ...options, dryRun: true });
    expect(preview[1]).toMatchObject({
      email: existingEmail,
      customerNumber: existingNumber,
      customerId: customer.id,
      subscriptionId: subscription.id,
      reusedExistingCustomer: true,
    });
    expect(await prisma.invoice.count({ where: { customerId: customer.id } })).toBe(1);
    const results = await seedOverdueCustomers(prisma, options);
    expect(results[1]).toMatchObject({
      email: existingEmail,
      customerNumber: existingNumber,
      customerId: customer.id,
      subscriptionId: subscription.id,
      reusedExistingCustomer: true,
      stage: 'SUSPENSION_SCHEDULED',
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      email: existingEmail,
      passwordHash,
      emailVerifiedAt: now,
    });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject(
      customer,
    );
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } }),
    ).toMatchObject({
      status: 'ACTIVE',
      billingMode: subscription.billingMode,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripePriceId: subscription.stripePriceId,
      stripePaymentMethodId: subscription.stripePaymentMethodId,
      stripeStatus: subscription.stripeStatus,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      monthlyCents: subscription.monthlyCents,
      gracePeriodEndsAt: new Date(results[1].suspensionDate!),
    });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).toEqual(paid);
    expect(await prisma.payment.count({ where: { invoiceId: paid.id, status: 'SUCCEEDED' } })).toBe(
      1,
    );
    expect(await prisma.invoice.count({ where: { customerId: customer.id } })).toBe(2);
    expect(await prisma.subscription.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(3);
    const rerun = await seedOverdueCustomers(prisma, options);
    expect(rerun[1]).toMatchObject({
      result: 'existing',
      reusedExistingCustomer: true,
      customerNumber: existingNumber,
    });
    expect(await prisma.invoice.count({ where: { customerId: customer.id } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(3);
  }, 30_000);
});
