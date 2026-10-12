import { AccountInvitationStatus } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import type { PrismaService } from '../../database/prisma.service';
import { EmailQueueService } from './email-queue.service';
import type { EmailProvider } from './email-provider';

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();
let mockProcessor: (job: Record<string, unknown>) => Promise<unknown>;
let mockQueueOptions: Record<string, unknown>;
let mockWorkerOptions: Record<string, unknown>;

jest.mock('bullmq', () => ({
  Queue: class {
    constructor(_name: string, options: Record<string, unknown>) {
      mockQueueOptions = options;
    }

    add = mockQueueAdd;
    close = mockQueueClose;
  },
  Worker: class {
    constructor(
      _name: string,
      processor: (job: Record<string, unknown>) => Promise<unknown>,
      options: Record<string, unknown>,
    ) {
      mockProcessor = processor;
      mockWorkerOptions = options;
    }

    on = mockWorkerOn;
    close = mockWorkerClose;
  },
}));

function createService(invitationStatus = AccountInvitationStatus.PENDING, producerOnly = false) {
  const emailProvider = {
    send: jest.fn().mockResolvedValue({ messageId: 'provider-message-id' }),
  };
  const prisma = {
    invoice: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    collectionPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    accountInvitation: {
      findUnique: jest.fn().mockResolvedValue({
        status: invitationStatus,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const config = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'email') {
        return {
          queue: {
            name: 'test-email-queue',
            attempts: 3,
            backoffMilliseconds: 500,
            concurrency: 2,
            encryptionKey: 'test-email-queue-encryption-key-at-least-32-characters',
          },
        };
      }
      if (key === 'overdueLifecycle')
        return {
          firstReminderDays: 1,
          secondReminderDays: 3,
          finalWarningDays: 5,
          gracePeriodDays: 7,
          dayMilliseconds: 86400000,
        };
      if (key === 'redis') return { url: 'redis://localhost:6380' };
      if (key === 'jwt') return { refreshSecret: 'unused-refresh-secret' };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  const service = new EmailQueueService(
    config as never,
    emailProvider as EmailProvider,
    prisma as unknown as PrismaService,
  );
  if (producerOnly) service.initializeProducer();
  else service.onModuleInit();
  return { emailProvider, prisma, service };
}

describe('EmailQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueAdd.mockImplementation((_name, data, options) =>
      Promise.resolve({ id: options.jobId, data }),
    );
    mockQueueClose.mockResolvedValue(undefined);
    mockWorkerClose.mockResolvedValue(undefined);
  });

  it('can enqueue from a script without starting a competing delivery worker', async () => {
    const { service } = createService(AccountInvitationStatus.PENDING, true);
    expect(mockWorkerOn).not.toHaveBeenCalled();
    await expect(
      service.enqueue(
        {
          to: 'customer@example.com',
          subject: 'Reminder',
          text: 'Reminder',
          html: '<p>Reminder</p>',
        },
        { purpose: 'SECOND_REMINDER' },
        'seed-job',
      ),
    ).resolves.toEqual({ jobId: 'seed-job', recipient: 'customer@example.com' });
    await service.onModuleDestroy();
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockWorkerClose).not.toHaveBeenCalled();
  });

  it('queues encrypted PII with deterministic IDs and exponential retries', async () => {
    const { service } = createService();
    const message = {
      to: 'dynamic.customer@example.com',
      subject: 'Activate your account',
      text: 'Secret activation token: token-value',
      html: '<p>Secret activation token: token-value</p>',
    };

    await expect(
      service.enqueue(
        message,
        { purpose: 'ACCOUNT_INVITATION', invitationId: 'invitation-id' },
        'account-invitation-invitation-id',
      ),
    ).resolves.toEqual({
      jobId: 'account-invitation-invitation-id',
      recipient: message.to,
    });

    const queuedData = mockQueueAdd.mock.calls[0][1];
    expect(JSON.stringify(queuedData)).not.toContain(message.to);
    expect(JSON.stringify(queuedData)).not.toContain('token-value');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'ACCOUNT_INVITATION',
      expect.objectContaining({ encryptedPayload: expect.stringMatching(/^v1\./) }),
      { jobId: 'account-invitation-invitation-id' },
    );
    expect(mockQueueOptions).toEqual(
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 500 },
        }),
      }),
    );
    expect(mockWorkerOptions).toEqual(expect.objectContaining({ concurrency: 2 }));
  });

  it('delivers a valid invitation and records provider evidence', async () => {
    const { emailProvider, prisma, service } = createService();
    await service.enqueue(
      {
        to: 'customer@example.com',
        subject: 'Activate',
        text: 'Activation link',
        html: '<p>Activation link</p>',
      },
      { purpose: 'ACCOUNT_INVITATION', invitationId: 'invitation-id' },
      'account-invitation-invitation-id',
    );
    const data = mockQueueAdd.mock.calls[0][1];

    await mockProcessor({
      id: 'account-invitation-invitation-id',
      name: 'ACCOUNT_INVITATION',
      data,
      opts: { attempts: 3 },
      attemptsMade: 0,
    });

    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.com' }),
    );
    expect(prisma.accountInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sentAt: expect.any(Date) } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'EMAIL_DELIVERY_SENT' }),
      }),
    );
  });

  it('does not deliver a queued invitation after it is revoked', async () => {
    const { emailProvider, service } = createService(AccountInvitationStatus.REVOKED);
    await service.enqueue(
      { to: 'customer@example.com', subject: 'Activate', text: 'Link', html: '<p>Link</p>' },
      { purpose: 'ACCOUNT_INVITATION', invitationId: 'invitation-id' },
      'account-invitation-invitation-id',
    );

    await expect(
      mockProcessor({
        id: 'account-invitation-invitation-id',
        name: 'ACCOUNT_INVITATION',
        data: mockQueueAdd.mock.calls[0][1],
        opts: { attempts: 3 },
        attemptsMade: 0,
      }),
    ).resolves.toEqual({ messageId: 'skipped-invalid-invitation', skipped: true });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('records a plan-change delivery against the plan-change request', async () => {
    const { prisma, service } = createService();
    await service.enqueue(
      {
        to: 'customer@example.com',
        subject: 'Plan changed',
        text: 'Your new plan is active.',
        html: '<p>Your new plan is active.</p>',
      },
      { purpose: 'PLAN_CHANGE_APPLIED', planChangeRequestId: 'plan-change-id' },
      'plan-change-plan-change-id-applied',
    );

    await mockProcessor({
      id: 'plan-change-plan-change-id-applied',
      name: 'PLAN_CHANGE_APPLIED',
      data: mockQueueAdd.mock.calls[0][1],
      opts: { attempts: 3 },
      attemptsMade: 0,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EMAIL_DELIVERY_SENT',
        entityType: 'PlanChangeRequest',
        entityId: 'plan-change-id',
        metadata: expect.objectContaining({ purpose: 'PLAN_CHANGE_APPLIED' }),
      }),
    });
  });
  it.each(['FINAL_WARNING', 'RECOVERY_FINAL_WARNING'] as const)(
    'suppresses %s queued before a later confirmed payment',
    async (purpose) => {
      const { service, prisma, emailProvider } = createService();
      prisma.invoice.findUnique.mockResolvedValue({
        status: 'OVERDUE',
        totalCents: 7990,
        payments: [{ amountCents: 7990, status: 'SUCCEEDED' }],
      });
      await service.enqueue(
        { to: 'customer@example.com', subject: 'Final', text: 'Old', html: 'Old' },
        { purpose, invoiceId: 'invoice' },
        'reminder',
      );
      const result = await mockProcessor({
        id: 'reminder',
        name: purpose,
        data: mockQueueAdd.mock.calls[0][1],
        opts: { attempts: 3 },
        attemptsMade: 0,
      });
      expect(result).toEqual({ messageId: 'skipped-resolved-collection', skipped: true });
      expect(emailProvider.send).not.toHaveBeenCalled();
    },
  );
  it('suppresses a delayed final email with an expired effective deadline', async () => {
    const { service, prisma, emailProvider } = createService();
    prisma.invoice.findUnique.mockResolvedValue({
      status: 'OVERDUE',
      totalCents: 7990,
      payments: [],
      dueDate: new Date('2000-01-01'),
      subscription: { status: 'ACTIVE', graceExtendedUntil: null },
      finalWarningSentAt: new Date('2000-01-06'),
    });
    await service.enqueue(
      { to: 'customer@example.com', subject: 'Final', text: 'Old', html: 'Old' },
      { purpose: 'FINAL_WARNING', invoiceId: 'invoice' },
      'reminder',
    );
    expect(
      await mockProcessor({
        id: 'reminder',
        name: 'FINAL_WARNING',
        data: mockQueueAdd.mock.calls[0][1],
        opts: { attempts: 3 },
        attemptsMade: 0,
      }),
    ).toEqual({ messageId: 'skipped-expired-collection-deadline', skipped: true });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });
  it('renders queued final email again with the current admin deadline and partial balance', async () => {
    const { service, prisma, emailProvider } = createService();
    prisma.invoice.findUnique.mockResolvedValue({
      invoiceNumber: 'INV',
      currency: 'AUD',
      status: 'OVERDUE',
      totalCents: 7990,
      payments: [{ amountCents: 2000, status: 'SUCCEEDED' }],
      dueDate: new Date('2100-01-01'),
      customer: { firstName: 'Sam', lastName: 'Customer' },
      subscription: {
        status: 'ACTIVE',
        graceExtendedUntil: new Date('2100-01-12'),
        collectionHoldReason: 'Expired dispute',
        collectionHoldUntil: new Date('2000-01-01'),
      },
      finalWarningSentAt: new Date('2100-01-06'),
    });
    await service.enqueue(
      {
        to: 'customer@example.com',
        subject: 'Old final',
        text: 'Old deadline',
        html: 'Old deadline',
      },
      {
        purpose: 'FINAL_WARNING',
        invoiceId: 'invoice',
        collectionEmail: {
          brandLogoUrl: 'https://mero.test/logo',
          dashboardUrl: 'https://mero.test/customer/invoices?invoiceId=invoice',
        },
      },
      'reminder',
    );
    await mockProcessor({
      id: 'reminder',
      name: 'FINAL_WARNING',
      data: mockQueueAdd.mock.calls[0][1],
      opts: { attempts: 3 },
      attemptsMade: 0,
    });
    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'FINAL NOTICE — service suspension scheduled for 12 January 2100',
        text: expect.stringContaining('$59.90'),
      }),
    );
    expect(emailProvider.send.mock.calls[0][0].text).not.toContain('Old deadline');
  });
  it.each(['FIRST_REMINDER', 'SECOND_REMINDER', 'FINAL_WARNING', 'RECOVERY_FINAL_WARNING'])(
    'suppresses queued %s while collection is on hold',
    async (purpose) => {
      const { service, prisma, emailProvider } = createService();
      prisma.invoice.findUnique.mockResolvedValue({
        status: 'OVERDUE',
        totalCents: 7990,
        payments: [],
        subscription: {
          status: 'ACTIVE',
          collectionHoldReason: 'Billing dispute',
          collectionHoldUntil: new Date('2100-01-01'),
        },
      });
      await service.enqueue(
        { to: 'customer@example.com', subject: 'Warning', text: 'Warning', html: 'Warning' },
        { purpose, invoiceId: 'invoice' },
        'held-warning',
      );
      expect(
        await mockProcessor({
          id: 'held-warning',
          name: purpose,
          data: mockQueueAdd.mock.calls[0][1],
          opts: { attempts: 3 },
          attemptsMade: 0,
        }),
      ).toEqual({ messageId: 'skipped-active-collection-hold', skipped: true });
      expect(emailProvider.send).not.toHaveBeenCalled();
    },
  );
});
