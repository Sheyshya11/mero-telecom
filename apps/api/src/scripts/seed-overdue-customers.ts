import { CollectionStage, NotificationSeverity, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { isEmail } from 'class-validator';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import configuration, { type AppConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';
import { EmailQueueService } from '../modules/notifications/email-queue.service';
import { NodemailerEmailProvider } from '../modules/notifications/nodemailer-email.provider';
import { MERO_TELECOM_LOGO_PATH } from '../modules/notifications/templates/email-brand';
import { hasActiveCollectionHold } from '../modules/subscriptions/collection-hold.policy';
import {
  overdueCommunication,
  renderOverdueEmail,
} from '../modules/notifications/templates/overdue-email.template';
import {
  collectionSettingsFromConfig,
  collectionExtension,
  payableCents,
  suspensionDate,
  RECOVERY_WINDOW_MS,
  type CollectionWarning,
} from '../modules/subscriptions/collection-deadline';
import { validateCollectionPolicy } from '../modules/subscriptions/collection-policy.service';
import { assertNonProductionDatabaseCommand } from './database-command-safety';

const DAY_MS = 86_400_000;
const PLAN_NAME = 'Overdue warning fixture plan';
const PLAN_DESCRIPTION = 'Local overdue warning fixtures only; no Stripe price or real service.';
const TOTAL_CENTS = 7900;
const scenarios = [
  {
    key: 'SECOND',
    firstName: 'Second',
    event: 'SECOND_REMINDER',
    email: 'subhamshrestha500@gmail.com',
  },
  { key: 'FINAL', firstName: 'Final', event: 'FINAL_WARNING', email: 'heyebav950@copytosh.com' },
  {
    key: 'RECOVERY',
    firstName: 'Recovery',
    event: 'RECOVERY_FINAL_WARNING',
    email: '5hvunoq2af@ooynib.com',
  },
] as const;

interface SeedOptions {
  batch: string;
  password: string;
  now?: Date;
  dryRun?: boolean;
  reuseExistingFinal?: boolean;
  emails?: Partial<Record<'SECOND' | 'FINAL' | 'RECOVERY', string>>;
}

export function assertLocalFixtureDatabase(environment: string | undefined, databaseUrl: string) {
  assertNonProductionDatabaseCommand(environment, 'Overdue customer fixtures');
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('Overdue customer fixtures require a local PostgreSQL database.');
  }
}

export async function seedOverdueCustomers(prisma: PrismaClient, options: SeedOptions) {
  if (!/^[a-z0-9-]{1,12}$/.test(options.batch)) {
    throw new Error('Batch must contain 1–12 lowercase letters, numbers or hyphens.');
  }
  if (options.password.length < 12 || options.password.length > 128) {
    throw new Error('Fixture password must contain 12–128 characters.');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid fixture time.');
  const settings = configuration().overdueLifecycle;
  // Invoice.dueDate is a PostgreSQL DATE: accelerated sub-day clocks cannot preserve these stages.
  if (settings.dayMilliseconds !== DAY_MS) {
    throw new Error(
      'Use OVERDUE_DEMO_DAY_MS=86400000 for both API and script to seed these fixtures.',
    );
  }
  const passwordHash = options.dryRun ? undefined : await hash(options.password, 12);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'overdue-fixtures-' + options.batch}))`;
      const policy =
        (await tx.collectionPolicy.findUnique({ where: { id: 'default' } })) ??
        collectionSettingsFromConfig(settings);
      validateCollectionPolicy(policy);
      const results = [];
      let planId: string | undefined;
      for (const scenario of scenarios) {
        let customerNumber = `CUST-OD-${options.batch}-${scenario.key}`;
        const invoiceNumber = `INV-OD-${options.batch}-${scenario.key}`;
        const email = (
          options.emails?.[scenario.key] ??
          (options.batch === 'contacts'
            ? scenario.email
            : `overdue-${options.batch}-${scenario.key.toLowerCase()}@merotelecom.test`)
        )
          .trim()
          .toLowerCase();
        if (!isEmail(email) || email.length > 320)
          throw new Error(`Invalid fixture email for ${scenario.key}.`);
        const markerKey = `overdue-fixture-${options.batch}-${scenario.key}`;
        const marker = await tx.auditLog.findUnique({ where: { deduplicationKey: markerKey } });
        const existing = await tx.invoice.findUnique({
          where: { invoiceNumber },
          include: { customer: true, subscription: true },
        });
        if (marker || existing) {
          const markerData =
            marker?.metadata &&
            typeof marker.metadata === 'object' &&
            !Array.isArray(marker.metadata)
              ? marker.metadata
              : undefined;
          const reused =
            options.reuseExistingFinal &&
            scenario.key === 'FINAL' &&
            markerData?.reusedExistingCustomer === true &&
            markerData.customerId === existing?.customerId;
          if (
            !marker ||
            !existing ||
            marker.action !== 'DEMO_OVERDUE_FIXTURE_CREATED' ||
            marker.entityId !== existing.id ||
            (existing.customer.customerNumber !== customerNumber && !reused) ||
            !existing.subscription ||
            existing.subscription.customerId !== existing.customerId
          )
            throw new Error(
              `Fixture collision for ${invoiceNumber}; existing records were not changed.`,
            );
          results.push({
            result: 'existing',
            scenario: scenario.event,
            email: existing.customer.email,
            customerNumber: existing.customer.customerNumber,
            reusedExistingCustomer: Boolean(reused),
            invoiceNumber,
            customerId: existing.customerId,
            subscriptionId: existing.subscriptionId,
            invoiceId: existing.id,
            stage: existing.collectionStage,
            serviceStatus: existing.subscription.status,
            dueDate: existing.dueDate.toISOString(),
            suspensionDate:
              existing.suspensionScheduledAt?.toISOString() ??
              existing.originalSuspensionDeadline?.toISOString(),
          });
          continue;
        }
        const collision = await tx.customer.findFirst({
          where: { OR: [{ customerNumber }, { email }] },
          include: {
            user: { include: { roles: true } },
            subscriptions: {
              include: {
                invoices: { include: { payments: true } },
                provisioningRequests: { where: { status: 'PENDING' }, select: { id: true } },
                cancellationRequests: {
                  where: { status: { notIn: ['COMPLETED', 'REJECTED', 'REVOKED'] } },
                  select: { id: true },
                },
                serviceRelocations: {
                  where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'FORCE_CLOSED'] } },
                  select: { id: true },
                },
              },
            },
          },
        });
        const reusableCustomer =
          options.reuseExistingFinal && scenario.key === 'FINAL' && collision?.email === email
            ? collision
            : null;
        const reusableSubscription = reusableCustomer?.subscriptions.filter(
          (sub) => sub.status === 'ACTIVE',
        )[0];
        if (reusableCustomer) {
          if (
            !reusableCustomer.user?.isActive ||
            reusableCustomer.user.status !== 'ACTIVE' ||
            !reusableCustomer.user.roles.some((role) => role.role === 'CUSTOMER') ||
            !reusableSubscription ||
            reusableCustomer.subscriptions.filter((sub) => sub.status === 'ACTIVE').length !== 1 ||
            reusableSubscription.graceExtendedUntil ||
            reusableSubscription.collectionHoldReason ||
            reusableSubscription.provisioningRequests.length ||
            reusableSubscription.cancellationRequests.length ||
            reusableSubscription.serviceRelocations.length ||
            reusableSubscription.invoices.some(
              (invoice) =>
                ['ISSUED', 'OVERDUE'].includes(invoice.status) &&
                invoice.totalCents >
                  invoice.payments
                    .filter((payment) =>
                      ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status),
                    )
                    .reduce((total, payment) => total + payment.amountCents, 0),
            )
          ) {
            throw new Error(
              `Existing customer ${email} is not eligible for a clean final-warning fixture; existing records were not changed.`,
            );
          }
          customerNumber = reusableCustomer.customerNumber;
        } else if (
          collision ||
          (await tx.user.findUnique({ where: { email }, select: { id: true } }))
        ) {
          throw new Error(
            `Fixture identity collision for ${email} (${customerNumber}); existing records were not changed.`,
          );
        }
        const recovery = scenario.event === 'RECOVERY_FINAL_WARNING';
        const final = scenario.event !== 'SECOND_REMINDER';
        const overdueDays = recovery
          ? policy.suspensionDays + 1
          : final
            ? policy.finalWarningDays
            : policy.secondReminderDays;
        const dueDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
            overdueDays * DAY_MS,
        );
        const originalDeadline = new Date(dueDate.getTime() + policy.suspensionDays * DAY_MS);
        const deadline = recovery ? new Date(now.getTime() + RECOVERY_WINDOW_MS) : originalDeadline;
        const firstSent = new Date(dueDate.getTime() + policy.firstReminderDays * DAY_MS);
        const secondSent = new Date(dueDate.getTime() + policy.secondReminderDays * DAY_MS);
        const finalSent = new Date(dueDate.getTime() + policy.finalWarningDays * DAY_MS);
        const issueDate = new Date(dueDate.getTime() - 14 * DAY_MS);
        const periodEnd = new Date(issueDate.getTime() + 30 * DAY_MS);
        const stage = final
          ? CollectionStage.SUSPENSION_SCHEDULED
          : CollectionStage.SECOND_REMINDER;
        if (options.dryRun) {
          results.push({
            result: 'would create',
            reusedExistingCustomer: Boolean(reusableCustomer),
            customerId: reusableCustomer?.id,
            subscriptionId: reusableSubscription?.id,
            scenario: scenario.event,
            email,
            customerNumber,
            invoiceNumber,
            stage,
            serviceStatus: 'ACTIVE',
            dueDate: dueDate.toISOString(),
            suspensionDate: deadline.toISOString(),
          });
          continue;
        }
        if (!reusableCustomer && !planId) {
          let plan = await tx.internetPlan.findUnique({ where: { name: PLAN_NAME } });
          if (
            plan &&
            (plan.description !== PLAN_DESCRIPTION ||
              plan.stripePriceId ||
              plan.isPublic ||
              plan.monthlyCents !== TOTAL_CENTS)
          ) {
            throw new Error('Fixture plan name is already in use; existing plan was not changed.');
          }
          plan ??= await tx.internetPlan.create({
            data: {
              name: PLAN_NAME,
              description: PLAN_DESCRIPTION,
              downloadMbps: 100,
              uploadMbps: 20,
              monthlyCents: TOTAL_CENTS,
              isPublic: false,
              isAvailable: false,
            },
          });
          planId = plan.id;
        }
        const user =
          reusableCustomer?.user ??
          (await tx.user.create({
            data: {
              email,
              passwordHash,
              displayName: `${scenario.firstName} Overdue Demo`,
              status: 'ACTIVE',
              isActive: true,
              emailVerifiedAt: now,
              roles: { create: { role: 'CUSTOMER' } },
            },
          }));
        const address = {
          addressLine1: '15 King William Street',
          suburb: 'Adelaide',
          state: 'SA',
          postcode: '5000',
        };
        const customer =
          reusableCustomer ??
          (await tx.customer.create({
            data: {
              userId: user.id,
              customerNumber,
              firstName: scenario.firstName,
              lastName: 'Overdue Demo',
              email,
              phone: '0400000099',
              ...address,
              addresses: { create: { type: 'SERVICE', ...address } },
            },
          }));
        const serviceAddress = reusableCustomer
          ? null
          : await tx.serviceAddress.create({
              data: {
                customerId: customer.id,
                ...address,
                technology: 'FTTP',
                maximumSpeedMbps: 1000,
              },
            });
        const subscription = reusableSubscription
          ? await tx.subscription.update({
              where: { id: reusableSubscription.id },
              data: {
                pastDueAt: reusableSubscription.pastDueAt ?? dueDate,
                gracePeriodEndsAt: deadline,
                overdueReminderStage: 3,
                suspensionWarningSentAt: finalSent,
              },
            })
          : await tx.subscription.create({
              data: {
                customerId: customer.id,
                planId: planId!,
                monthlyCents: TOTAL_CENTS,
                status: 'ACTIVE',
                billingMode: 'MANUAL',
                startDate: issueDate,
                billingAnchorDay: issueDate.getUTCDate(),
                currentPeriodStart: issueDate,
                currentPeriodEnd: periodEnd,
                currentServiceAddressId: serviceAddress!.id,
                pastDueAt: dueDate,
                gracePeriodEndsAt: deadline,
                overdueReminderStage: final ? 3 : 2,
                suspensionWarningSentAt: final ? (recovery ? now : finalSent) : null,
              },
            });
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            customerId: customer.id,
            subscriptionId: subscription.id,
            type: 'MANUAL',
            issueDate,
            issuedAt: issueDate,
            dueDate,
            overdueAt: dueDate,
            billingPeriodStart: issueDate,
            billingPeriodEnd: periodEnd,
            subtotalCents: 7182,
            taxCents: 718,
            totalCents: TOTAL_CENTS,
            currency: 'AUD',
            status: 'OVERDUE',
            collectionStage: stage,
            firstReminderSentAt: firstSent,
            secondReminderSentAt: secondSent,
            finalWarningSentAt: final && !recovery ? finalSent : null,
            originalSuspensionDeadline: originalDeadline,
            recoverySuspensionDeadline: recovery ? deadline : null,
            recoveryFinalWarningSentAt: recovery ? now : null,
            suspensionScheduledAt: final ? deadline : null,
            items: {
              create: {
                description: 'Demo monthly internet service (GST included)',
                quantity: 1,
                unitPriceCents: TOTAL_CENTS,
                amountCents: TOTAL_CENTS,
              },
            },
          },
        });
        const notices: Array<{ event: CollectionWarning; sentAt: Date }> = [
          { event: 'FIRST_REMINDER', sentAt: firstSent },
          { event: 'SECOND_REMINDER', sentAt: secondSent },
        ];
        if (final) notices.push({ event: scenario.event, sentAt: recovery ? now : finalSent });
        for (const notice of notices) {
          const content = overdueCommunication({
            event: notice.event,
            invoiceNumber,
            amountCents: TOTAL_CENTS,
            currency: 'AUD',
            gracePeriodEndsAt:
              notice.event === 'RECOVERY_FINAL_WARNING' ? deadline : originalDeadline,
          });
          const audit = await tx.auditLog.create({
            data: {
              action: notice.event,
              entityType: 'Invoice',
              entityId: invoice.id,
              deduplicationKey: `${invoice.id}-${notice.event}`,
              notificationEvent: notice.event,
              notificationDeliveredAt: notice.sentAt,
              createdAt: notice.sentAt,
              metadata: {
                invoiceId: invoice.id,
                subscriptionId: subscription.id,
                simulated: true,
                notificationOutcome: 'SIMULATED',
                source: 'seed-overdue-customers',
                emailSent: false,
              },
            },
          });
          const noticeFinal = ['FINAL_WARNING', 'RECOVERY_FINAL_WARNING'].includes(notice.event);
          await tx.notification.create({
            data: {
              userId: user.id,
              type: noticeFinal ? 'FINAL_PAYMENT_WARNING' : 'PAYMENT_REMINDER',
              severity: noticeFinal ? NotificationSeverity.CRITICAL : NotificationSeverity.WARNING,
              title: content.title,
              message: content.intro,
              createdAt: notice.sentAt,
              actionUrl: `/customer/invoices?invoiceId=${invoice.id}`,
              entityType: 'Invoice',
              entityId: invoice.id,
              deduplicationKey: `lifecycle-${subscription.id}-${notice.event.toLowerCase()}-${audit.id}`,
              metadata: {
                collectionStage: notice.event,
                invoiceId: invoice.id,
                suspensionDate: (notice.event === 'RECOVERY_FINAL_WARNING'
                  ? deadline
                  : originalDeadline
                ).toISOString(),
                actionLabel: content.action,
                simulated: true,
                emailSent: false,
              },
            },
          });
        }
        if (recovery) {
          for (const action of [
            'ORIGINAL_GRACE_EXPIRED',
            'FINAL_WARNING_MISSED',
            'RECOVERY_SAFETY_EXTENSION',
          ]) {
            await tx.auditLog.create({
              data: {
                action,
                entityType: 'Invoice',
                entityId: invoice.id,
                deduplicationKey: `${invoice.id}-${action}`,
                metadata: {
                  simulated: true,
                  subscriptionId: subscription.id,
                  originalDeadline: originalDeadline.toISOString(),
                  recoveryDeadline: deadline.toISOString(),
                  hours: 48,
                },
              },
            });
          }
        }
        if (final)
          await tx.auditLog.create({
            data: {
              action: 'SUSPENSION_SCHEDULED',
              entityType: 'Invoice',
              entityId: invoice.id,
              deduplicationKey: `${invoice.id}-SUSPENSION_SCHEDULED`,
              metadata: {
                simulated: true,
                subscriptionId: subscription.id,
                suspensionDate: deadline.toISOString(),
              },
            },
          });
        await tx.auditLog.create({
          data: {
            deduplicationKey: markerKey,
            action: 'DEMO_OVERDUE_FIXTURE_CREATED',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: {
              batch: options.batch,
              scenario: scenario.event,
              customerId: customer.id,
              reusedExistingCustomer: Boolean(reusableCustomer),
              simulated: true,
              emailSent: false,
            },
          },
        });
        results.push({
          result: 'created',
          reusedExistingCustomer: Boolean(reusableCustomer),
          scenario: scenario.event,
          email,
          customerNumber,
          invoiceNumber,
          customerId: customer.id,
          subscriptionId: subscription.id,
          invoiceId: invoice.id,
          stage,
          serviceStatus: subscription.status,
          dueDate: dueDate.toISOString(),
          suspensionDate: deadline.toISOString(),
        });
      }
      return results;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** Queue only each fixture's current alert after the seed transaction has committed. */
export async function queueOverdueFixtureEmails(
  prisma: PrismaClient,
  queue: Pick<EmailQueueService, 'enqueue'>,
  fixtures: Array<{ invoiceNumber: string; scenario: CollectionWarning }>,
  settings: AppConfig = configuration(),
) {
  const results = [];
  for (const fixture of fixtures) {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'seed-email-' + fixture.invoiceNumber}))`;
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { invoiceNumber: fixture.invoiceNumber },
          include: { customer: true, subscription: true, payments: true },
        });
        const event = fixture.scenario;
        const jobId = `seed-overdue-${invoice.id}-${event.toLowerCase()}`;
        const markerKey = `${invoice.id}-SEED_EMAIL-${event}`;
        const base = { invoiceNumber: invoice.invoiceNumber, event, jobId };
        const highest = invoice.recoveryFinalWarningSentAt
          ? 'RECOVERY_FINAL_WARNING'
          : invoice.finalWarningSentAt
            ? 'FINAL_WARNING'
            : invoice.secondReminderSentAt
              ? 'SECOND_REMINDER'
              : 'FIRST_REMINDER';
        if (
          invoice.status !== 'OVERDUE' ||
          payableCents(invoice) <= 0 ||
          !invoice.subscription ||
          !['ACTIVE', 'PAST_DUE'].includes(invoice.subscription.status) ||
          hasActiveCollectionHold(invoice.subscription) ||
          highest !== event
        ) {
          return {
            ...base,
            status: 'skipped',
            reason: 'Invoice is settled, held, inactive or its warning has progressed.',
          };
        }
        const policy =
          (await tx.collectionPolicy.findUnique({ where: { id: 'default' } })) ??
          collectionSettingsFromConfig(settings.overdueLifecycle);
        const siblings = await tx.invoice.findMany({
          where: {
            subscriptionId: invoice.subscriptionId,
            status: { in: ['ISSUED', 'OVERDUE'] },
          },
          include: { payments: true },
        });
        const deadline = suspensionDate(
          invoice,
          collectionExtension(invoice.subscription.graceExtendedUntil, siblings),
          policy,
          settings.overdueLifecycle.dayMilliseconds,
        );
        if (deadline <= new Date())
          return { ...base, status: 'skipped', reason: 'Collection deadline has expired.' };
        const previous = await tx.auditLog.findUnique({ where: { deduplicationKey: markerKey } });
        if (previous) return { ...base, status: 'already queued' };
        const recipient =
          settings.email.deliveryMode === 'direct'
            ? invoice.customer.email
            : settings.email.developmentRecipient;
        if (!isEmail(recipient)) throw new Error('Configure a valid email delivery recipient.');
        const branding = {
          brandLogoUrl: `${settings.app.frontendUrl}${MERO_TELECOM_LOGO_PATH}`,
          dashboardUrl: `${settings.app.frontendUrl}/customer/invoices?invoiceId=${invoice.id}`,
        };
        const template = renderOverdueEmail({
          event,
          ...branding,
          customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
          invoiceNumber: invoice.invoiceNumber,
          amountCents: payableCents(invoice),
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          gracePeriodEndsAt: deadline,
        });
        const queued = await queue.enqueue(
          { to: recipient, ...template },
          {
            purpose: event,
            invoiceId: invoice.id,
            subscriptionId: invoice.subscription.id,
            collectionEmail: branding,
          },
          jobId,
        );
        await tx.auditLog.create({
          data: {
            deduplicationKey: markerKey,
            action: 'DEMO_OVERDUE_EMAIL_QUEUED',
            entityType: 'Invoice',
            entityId: invoice.id,
            metadata: {
              recipient,
              jobId: queued.jobId,
              purpose: event,
              queuedAt: new Date().toISOString(),
              seededState: true,
              emailSent: false,
              source: 'seed-overdue-customers',
            },
          },
        });
        return { ...base, status: 'queued', recipient, subject: template.subject };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    results.push(result);
  }
  return results;
}

async function main() {
  config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  config({ path: resolve(__dirname, '../../.env'), quiet: true });
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'pnpm db:seed:overdue [--batch=contacts] [--dry-run] [--send-emails]\nCreates warning fixtures. --send-emails queues one current alert per customer; requires a running API email worker.',
    );
    return;
  }
  if (
    args.some(
      (arg) => arg !== '--dry-run' && arg !== '--send-emails' && !arg.startsWith('--batch='),
    ) ||
    args.filter((arg) => arg.startsWith('--batch=')).length > 1
  ) {
    throw new Error('Supported options: --batch=<name>, --dry-run, --send-emails, --help.');
  }
  assertLocalFixtureDatabase(process.env.NODE_ENV, process.env.DATABASE_URL ?? '');
  const batch = args.find((arg) => arg.startsWith('--batch='))?.slice(8) ?? 'contacts';
  const settings = configuration();
  const sendEmails = args.includes('--send-emails');
  const dryRun = args.includes('--dry-run');
  if (
    sendEmails &&
    (!settings.email.smtp.host ||
      !settings.email.from ||
      !settings.redis.url ||
      (settings.email.smtp.user && !settings.email.smtp.pass))
  ) {
    throw new Error('Configure SMTP, EMAIL_FROM and REDIS_URL before sending seed emails.');
  }
  const prisma = new PrismaService();
  let emailQueue: EmailQueueService | undefined;
  try {
    const results = await seedOverdueCustomers(prisma, {
      batch,
      reuseExistingFinal: batch === 'contacts',
      password: process.env.OVERDUE_FIXTURE_PASSWORD ?? 'ChangeMe123!',
      dryRun,
    });
    console.log(JSON.stringify(results, null, 2));
    if (sendEmails && !dryRun) {
      const emailConfig = new ConfigService<AppConfig, true>(settings);
      emailQueue = new EmailQueueService(
        emailConfig,
        new NodemailerEmailProvider(emailConfig),
        prisma,
      );
      emailQueue.initializeProducer();
      const deliveries = await queueOverdueFixtureEmails(prisma, emailQueue, results, settings);
      console.log(JSON.stringify({ emailDeliveries: deliveries }, null, 2));
      console.log(
        'Emails are queued for the API worker; queued does not mean SMTP delivery succeeded.',
      );
    } else {
      console.log(
        dryRun && sendEmails
          ? 'Dry run: would queue one current alert per customer. No emails were queued.'
          : 'Simulated warning history only. No emails were queued; add --send-emails to send current alerts.',
      );
    }
    console.log(
      'No Stripe charges were made. Existing fixture state and customer credentials are preserved.',
    );
    if (!dryRun)
      console.log(
        process.env.OVERDUE_FIXTURE_PASSWORD
          ? 'Login password: configured OVERDUE_FIXTURE_PASSWORD (applies only to newly created accounts).'
          : 'Demo login password for newly created accounts: ChangeMe123! Existing customer credentials are preserved.',
      );
    console.log(
      'The running API scheduler can advance these fixtures when their next deadline is reached.',
    );
  } finally {
    await emailQueue?.onModuleDestroy();
    await prisma.$disconnect();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Overdue fixture seed failed.');
    process.exitCode = 1;
  });
