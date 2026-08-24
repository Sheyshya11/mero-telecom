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

function createService(invitationStatus = AccountInvitationStatus.PENDING) {
  const emailProvider = {
    send: jest.fn().mockResolvedValue({ messageId: 'provider-message-id' }),
  };
  const prisma = {
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
  service.onModuleInit();
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
});
