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
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../database/prisma.service';
import { EmailProvider, type EmailSendResult } from './email-provider';

export type EmailPurpose =
  | 'ACCOUNT_INVITATION'
  | 'STAFF_INVITATION'
  | 'SUBSCRIPTION_CONFIRMATION'
  | 'PLAN_CHANGE_SCHEDULED'
  | 'PLAN_CHANGE_APPLIED'
  | 'PLAN_CHANGE_CANCELLED'
  | 'PLAN_CHANGE_FAILED';

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
    configService: ConfigService<AppConfig, true>,
    private readonly emailProvider: EmailProvider,
    private readonly prisma: PrismaService,
  ) {
    const emailQueue = configService.getOrThrow('email').queue;
    const configuredEncryptionKey = emailQueue.encryptionKey;
    const keyMaterial = configuredEncryptionKey || configService.getOrThrow('jwt').refreshSecret;

    this.queueName = emailQueue.name;
    this.redisUrl = configService.getOrThrow('redis').url;
    this.attempts = emailQueue.attempts;
    this.backoffMilliseconds = emailQueue.backoffMilliseconds;
    this.concurrency = emailQueue.concurrency;
    this.encryptionKey = createHash('sha256')
      .update(encryptionContext)
      .update(keyMaterial)
      .digest();
  }

  onModuleInit(): void {
    this.queue = new Queue<EncryptedEmailJob, EmailJobResult, EmailPurpose>(this.queueName, {
      connection: { url: this.redisUrl, maxRetriesPerRequest: 1 },
      defaultJobOptions: {
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMilliseconds },
        removeOnComplete: { age: 24 * 60 * 60, count: 500 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
      },
    });
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
      { jobId: idempotencyKey },
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
    const entityId =
      context.invitationId ??
      context.staffInvitationId ??
      context.checkoutApplicationId ??
      context.planChangeRequestId;
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
              : 'PlanChangeRequest',
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
      const entityId =
        context.invitationId ??
        context.staffInvitationId ??
        context.checkoutApplicationId ??
        context.planChangeRequestId;
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
                : 'PlanChangeRequest',
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
