import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountInvitationStatus, StaffInvitationStatus } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  payableCents,
  suspensionDate,
  collectionSettingsFromConfig,
  collectionExtension,
} from '../subscriptions/collection-deadline';
import { hasActiveCollectionHold } from '../subscriptions/collection-hold.policy';
import { MERO_TELECOM_LOGO_PATH } from './templates/email-brand';
import { renderOverdueEmail, type OverdueEmailEvent } from './templates/overdue-email.template';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { EmailProvider, type EmailSendResult } from './email-provider';

export type EmailPurpose =
  | 'ACCOUNT_INVITATION'
  | 'STAFF_INVITATION'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'SUBSCRIPTION_CONFIRMATION'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_AUTHENTICATION_REQUIRED'
  | 'FIRST_REMINDER'
  | 'SECOND_REMINDER'
  | 'FINAL_WARNING'
  | 'RECOVERY_FINAL_WARNING'
  | 'MANUAL_REMINDER'
  | 'GRACE_PERIOD_EXTENDED'
  | 'SERVICE_RESTORED'
  | 'OVERDUE_REMINDER'
  | 'SUSPENSION_WARNING'
  | 'SERVICE_SUSPENDED'
  | 'PAYMENT_RECEIVED'
  | 'SERVICE_RESTORATION_REQUESTED'
  | 'CANCELLATION_APPROVED'
  | 'CANCELLATION_REJECTED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLATION_SCHEDULED'
  | 'CANCELLATION_REVOKED'
  | 'CANCELLATION_COMPLETED'
  | 'CANCELLATION_OPERATIONAL_ALERT'
  | 'PLAN_CHANGE_SCHEDULED'
  | 'PLAN_CHANGE_APPLIED'
  | 'PLAN_CHANGE_CANCELLED'
  | 'PLAN_CHANGE_FAILED'
  | 'RELOCATION_REJECTED'
  | 'RELOCATION_REQUESTED'
  | 'RELOCATION_CONFIRMED'
  | 'RELOCATION_SCHEDULED'
  | 'RELOCATION_FAILED'
  | 'RELOCATION_COMPLETED'
  | 'REFUND_REQUESTED'
  | 'REFUND_MORE_INFORMATION_REQUIRED'
  | 'REFUND_APPROVED'
  | 'REFUND_REJECTED'
  | 'REFUND_SUCCEEDED'
  | 'REFUND_FAILED'
  | 'REFUND_RECONCILIATION_ALERT'
  | 'SUPPORT_NEW_CASE'
  | 'SUPPORT_CUSTOMER_REPLIED'
  | 'SUPPORT_STAFF_REPLIED'
  | 'SUPPORT_WAITING_FOR_CUSTOMER'
  | 'SUPPORT_RESOLVED'
  | 'SUPPORT_NEW_PROSPECT_ENQUIRY'
  | 'SUPPORT_PROSPECT_RECEIPT'
  | 'SUPPORT_PROSPECT_STAFF_REPLIED'
  | 'SUPPORT_PROSPECT_WAITING_FOR_CUSTOMER'
  | 'SUPPORT_PROSPECT_RESOLVED'
  | 'INTERNAL_REQUEST_NEW'
  | 'INTERNAL_REQUEST_STAFF_REPLIED'
  | 'INTERNAL_REQUEST_REVIEW_STARTED'
  | 'INTERNAL_REQUEST_MORE_INFO_REQUIRED'
  | 'INTERNAL_REQUEST_APPROVED'
  | 'INTERNAL_REQUEST_REJECTED'
  | 'INTERNAL_REQUEST_ADMIN_REPLIED'
  | 'INTERNAL_REQUEST_RESOLVED'
  | 'INTERNAL_REQUEST_CLOSED'
  | 'INTERNAL_REQUEST_ESCALATED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_ESCALATED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_ADMIN_REPLIED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_STAFF_REPLIED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_REVIEW_STARTED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_REPLIED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_MORE_INFO_REQUIRED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_APPROVED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_REJECTED'
  | 'INTERNAL_REQUEST_RETURNED_TO_ADMIN'
  | 'INTERNAL_REQUEST_RETURNED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_RESOLVED'
  | 'INTERNAL_REQUEST_SUPER_ADMIN_CLOSED';

interface QueueableEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface EmailJobContext {
  purpose: EmailPurpose;
  invitationId?: string;
  staffInvitationId?: string;
  checkoutApplicationId?: string;
  planChangeRequestId?: string;
  passwordResetTokenId?: string;
  userId?: string;
  refundId?: string;
  supportCaseId?: string;
  supportMessageId?: string;
  internalRequestId?: string;
  cancellationRequestId?: string;
  relocationRequestId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  collectionEmail?: { brandLogoUrl: string; dashboardUrl: string };
}

interface EmailJobPayload {
  message: QueueableEmailMessage;
  context: EmailJobContext;
}

interface EncryptedEmailJob {
  encryptedPayload: string;
}

interface EmailJobResult extends EmailSendResult {
  skipped?: boolean;
}

export interface QueuedEmailResult {
  jobId: string;
  recipient: string;
}

const encryptedPayloadVersion = 'v1';
const encryptionContext = 'mero-telecom-email-queue-v1';

@Injectable()
export class EmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueService.name);
  private readonly queueName: string;
  private readonly redisUrl: string;
  private readonly attempts: number;
  private readonly backoffMilliseconds: number;
  private readonly concurrency: number;
  private readonly encryptionKey: Buffer;
  private queue?: Queue<EncryptedEmailJob, EmailJobResult, EmailPurpose>;
  private worker?: Worker<EncryptedEmailJob, EmailJobResult, EmailPurpose>;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaService,
  ) {
    const emailQueue = configService.getOrThrow('email').queue;
    const configuredEncryptionKey = emailQueue.encryptionKey;
    const keyMaterial = configuredEncryptionKey || configService.getOrThrow('jwt').refreshSecret;

    this.queueName =
      process.env.NODE_ENV === 'test' ? `${emailQueue.name}-${randomUUID()}` : emailQueue.name;
    this.redisUrl = configService.getOrThrow('redis').url;
    this.attempts = emailQueue.attempts;
    this.backoffMilliseconds = emailQueue.backoffMilliseconds;
    this.concurrency = emailQueue.concurrency;
    this.encryptionKey = createHash('sha256')
      .update(encryptionContext)
      .update(keyMaterial)
      .digest();
  }

  /** Open only the producer connection for scripts; the running API owns delivery workers. */
  initializeProducer(): void {
    if (this.queue) return;
    this.queue = new Queue<EncryptedEmailJob, EmailJobResult, EmailPurpose>(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
      defaultJobOptions: {
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMilliseconds },
        removeOnComplete: { age: 24 * 60 * 60, count: 500 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
      },
    });
  }

  onModuleInit(): void {
    this.initializeProducer();
    this.worker = new Worker<EncryptedEmailJob, EmailJobResult, EmailPurpose>(
      this.queueName,
      (job) => this.process(job),
      {
        connection: { url: this.redisUrl, maxRetriesPerRequest: null },
        concurrency: this.concurrency,
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error(JSON.stringify({ event: 'email_worker_error', error: error.name }));
    });
    this.worker.on('failed', (job, error) => {
      if (!job) return;
      const configuredAttempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade >= configuredAttempts;
      this.logger.error(
        JSON.stringify({
          event: 'email_job_failed',
          jobId: job.id,
          purpose: job.name,
          attempt: job.attemptsMade,
          finalAttempt,
          error: error.name,
        }),
      );
      if (finalAttempt) void this.recordFinalFailure(job, error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(
    message: QueueableEmailMessage,
    context: EmailJobContext,
    idempotencyKey: string,
  ): Promise<QueuedEmailResult> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Email queue is not available. Please try again.');
    }
    const job = await this.queue.add(
      context.purpose,
      { encryptedPayload: this.encrypt({ message, context }) },
      {
        jobId: idempotencyKey,
        ...([
          'CANCELLATION_REQUESTED',
          'CANCELLATION_APPROVED',
          'CANCELLATION_REJECTED',
          'RELOCATION_REQUESTED',
          'RELOCATION_REJECTED',
          'FIRST_REMINDER',
          'SECOND_REMINDER',
          'FINAL_WARNING',
          'RECOVERY_FINAL_WARNING',
          'MANUAL_REMINDER',
          'GRACE_PERIOD_EXTENDED',
          'SERVICE_SUSPENDED',
          'SERVICE_RESTORED',
        ].some((event) => event === context.purpose)
          ? { removeOnComplete: false, removeOnFail: false }
          : {}),
      },
    );
    if (!job.id) {
      throw new ServiceUnavailableException('Email could not be queued. Please try again.');
    }
    return { jobId: job.id, recipient: message.to };
  }

  private async process(
    job: Job<EncryptedEmailJob, EmailJobResult, EmailPurpose>,
  ): Promise<EmailJobResult> {
    const payload = this.decrypt(job.data.encryptedPayload);
    if (
      payload.context.invoiceId &&
      [
        'FIRST_REMINDER',
        'SECOND_REMINDER',
        'FINAL_WARNING',
        'RECOVERY_FINAL_WARNING',
        'MANUAL_REMINDER',
        'GRACE_PERIOD_EXTENDED',
      ].some((event) => event === payload.context.purpose)
    ) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: payload.context.invoiceId },
        include: { customer: true, payments: true, subscription: true },
      });
      if (
        !invoice ||
        payableCents(invoice) <= 0 ||
        invoice.status !== 'OVERDUE' ||
        !invoice.subscription ||
        !['ACTIVE', 'PAST_DUE'].includes(invoice.subscription.status)
      )
        return { messageId: 'skipped-resolved-collection', skipped: true };
      const event = payload.context.purpose;
      if (
        ['FIRST_REMINDER', 'SECOND_REMINDER', 'FINAL_WARNING', 'RECOVERY_FINAL_WARNING'].includes(
          event,
        ) &&
        hasActiveCollectionHold(invoice.subscription)
      )
        return { messageId: 'skipped-active-collection-hold', skipped: true };
      const stages = [
        'FIRST_REMINDER',
        'SECOND_REMINDER',
        'FINAL_WARNING',
        'RECOVERY_FINAL_WARNING',
      ];
      const highest = invoice.recoveryFinalWarningSentAt
        ? 'RECOVERY_FINAL_WARNING'
        : invoice.finalWarningSentAt
          ? 'FINAL_WARNING'
          : invoice.secondReminderSentAt
            ? 'SECOND_REMINDER'
            : 'FIRST_REMINDER';
      if (stages.includes(event) && stages.indexOf(event) < stages.indexOf(highest))
        return { messageId: 'skipped-superseded-collection', skipped: true };
      const settings = this.configService.getOrThrow('overdueLifecycle');
      const policy =
        (await this.prisma.collectionPolicy.findUnique({ where: { id: 'default' } })) ??
        collectionSettingsFromConfig(settings);
      const siblings = await this.prisma.invoice.findMany({
        where: { subscriptionId: invoice.subscriptionId, status: { in: ['ISSUED', 'OVERDUE'] } },
        include: { payments: true },
      });
      const deadline = suspensionDate(
        invoice,
        collectionExtension(invoice.subscription.graceExtendedUntil, siblings),
        policy,
        settings.dayMilliseconds,
      );
      if (
        (event === 'FINAL_WARNING' ||
          event === 'RECOVERY_FINAL_WARNING' ||
          event === 'GRACE_PERIOD_EXTENDED') &&
        deadline <= new Date()
      )
        return { messageId: 'skipped-expired-collection-deadline', skipped: true };
      const branding = payload.context.collectionEmail ?? {
        brandLogoUrl: `${this.configService.getOrThrow('app').frontendUrl}${MERO_TELECOM_LOGO_PATH}`,
        dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/invoices?invoiceId=${invoice.id}`,
      };
      payload.message = {
        to: payload.message.to,
        ...renderOverdueEmail({
          event: event as OverdueEmailEvent,
          ...branding,
          customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
          invoiceNumber: invoice.invoiceNumber,
          amountCents: payableCents(invoice),
          currency: invoice.currency,
          dueDate: invoice.dueDate,
          gracePeriodEndsAt: deadline,
        }),
      };
    }
    if (payload.context.invitationId) {
      const invitation = await this.prisma.accountInvitation.findUnique({
        where: { id: payload.context.invitationId },
        select: { status: true, expiresAt: true },
      });
      if (
        !invitation ||
        invitation.status !== AccountInvitationStatus.PENDING ||
        invitation.expiresAt <= new Date()
      ) {
        return { messageId: 'skipped-invalid-invitation', skipped: true };
      }
    }
    if (payload.context.staffInvitationId) {
      const invitation = await this.prisma.staffInvitation.findUnique({
        where: { id: payload.context.staffInvitationId },
        select: { status: true, expiresAt: true },
      });
      if (
        !invitation ||
        invitation.status !== StaffInvitationStatus.PENDING ||
        invitation.expiresAt <= new Date()
      ) {
        return { messageId: 'skipped-invalid-invitation', skipped: true };
      }
    }
    if (payload.context.purpose === 'PASSWORD_RESET' && payload.context.passwordResetTokenId) {
      const token = await this.prisma.passwordResetToken.findUnique({
        where: { id: payload.context.passwordResetTokenId },
        select: { usedAt: true, revokedAt: true, expiresAt: true },
      });
      if (!token || token.usedAt || token.revokedAt || token.expiresAt <= new Date()) {
        return { messageId: 'skipped-invalid-password-reset', skipped: true };
      }
    }

    const delivery = await this.emailProvider.send(payload.message);
    await this.recordSuccess(job, payload.context, delivery.messageId);
    return delivery;
  }

  private async recordSuccess(
    job: Job<EncryptedEmailJob, EmailJobResult, EmailPurpose>,
    context: EmailJobContext,
    providerMessageId: string,
  ): Promise<void> {
    if (context.invitationId) {
      await this.prisma.accountInvitation.updateMany({
        where: { id: context.invitationId, status: AccountInvitationStatus.PENDING },
        data: { sentAt: new Date() },
      });
    }
    if (context.staffInvitationId) {
      await this.prisma.staffInvitation.updateMany({
        where: { id: context.staffInvitationId, status: StaffInvitationStatus.PENDING },
        data: { sentAt: new Date() },
      });
    }
    if (context.supportMessageId) {
      await this.prisma.supportMessage.updateMany({
        where: { id: context.supportMessageId },
        data: { emailDeliveryStatus: 'SENT' },
      });
    }
    const entityId =
      context.invitationId ??
      context.staffInvitationId ??
      context.checkoutApplicationId ??
      context.planChangeRequestId ??
      context.passwordResetTokenId ??
      context.refundId ??
      context.supportCaseId ??
      context.internalRequestId ??
      context.subscriptionId ??
      context.relocationRequestId ??
      context.userId;
    if (!entityId) return;
    await this.prisma.auditLog.create({
      data: {
        action: 'EMAIL_DELIVERY_SENT',
        entityType: context.invitationId
          ? 'AccountInvitation'
          : context.staffInvitationId
            ? 'StaffInvitation'
            : context.checkoutApplicationId
              ? 'CheckoutApplication'
              : context.planChangeRequestId
                ? 'PlanChangeRequest'
                : context.passwordResetTokenId
                  ? 'PasswordResetToken'
                  : context.refundId
                    ? 'Refund'
                    : context.supportCaseId
                      ? 'SupportCase'
                      : context.internalRequestId
                        ? 'InternalRequest'
                        : context.subscriptionId
                          ? 'Subscription'
                          : context.relocationRequestId
                            ? 'ServiceRelocation'
                            : 'User',
        entityId,
        metadata: {
          purpose: context.purpose,
          jobId: job.id,
          providerMessageId,
          attemptsMade: job.attemptsMade + 1,
        },
      },
    });
  }

  private async recordFinalFailure(
    job: Job<EncryptedEmailJob, EmailJobResult, EmailPurpose>,
    error: Error,
  ): Promise<void> {
    try {
      const { context } = this.decrypt(job.data.encryptedPayload);
      if (context.supportMessageId) {
        await this.prisma.supportMessage.updateMany({
          where: { id: context.supportMessageId },
          data: { emailDeliveryStatus: 'FAILED' },
        });
      }
      const entityId =
        context.invitationId ??
        context.staffInvitationId ??
        context.checkoutApplicationId ??
        context.planChangeRequestId ??
        context.passwordResetTokenId ??
        context.refundId ??
        context.supportCaseId ??
        context.internalRequestId ??
        context.subscriptionId ??
        context.relocationRequestId ??
        context.userId;
      if (!entityId) return;
      await this.prisma.auditLog.create({
        data: {
          action: 'EMAIL_DELIVERY_FAILED',
          entityType: context.invitationId
            ? 'AccountInvitation'
            : context.staffInvitationId
              ? 'StaffInvitation'
              : context.checkoutApplicationId
                ? 'CheckoutApplication'
                : context.planChangeRequestId
                  ? 'PlanChangeRequest'
                  : context.passwordResetTokenId
                    ? 'PasswordResetToken'
                    : context.refundId
                      ? 'Refund'
                      : context.supportCaseId
                        ? 'SupportCase'
                        : context.internalRequestId
                          ? 'InternalRequest'
                          : context.subscriptionId
                            ? 'Subscription'
                            : context.relocationRequestId
                              ? 'ServiceRelocation'
                              : 'User',
          entityId,
          metadata: {
            purpose: context.purpose,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            error: error.name,
          },
        },
      });
    } catch (auditError: unknown) {
      this.logger.error(
        JSON.stringify({
          event: 'email_failure_audit_failed',
          jobId: job.id,
          error: auditError instanceof Error ? auditError.name : 'UnknownError',
        }),
      );
    }
  }

  private encrypt(payload: EmailJobPayload): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, initializationVector);
    cipher.setAAD(Buffer.from(encryptionContext));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return [
      encryptedPayloadVersion,
      initializationVector.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  private decrypt(value: string): EmailJobPayload {
    const [version, initializationVector, authenticationTag, encrypted] = value.split('.');
    if (
      version !== encryptedPayloadVersion ||
      !initializationVector ||
      !authenticationTag ||
      !encrypted
    ) {
      throw new Error('Invalid encrypted email job payload.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(initializationVector, 'base64url'),
    );
    decipher.setAAD(Buffer.from(encryptionContext));
    decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as EmailJobPayload;
  }
}
