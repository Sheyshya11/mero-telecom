import type { AppConfig } from '../../config/configuration';
import type { EmailProvider } from './email-provider';
import { NotificationService } from './notification.service';

function createService(
  environment = 'development',
  deliveryMode: 'redirect' | 'direct' = 'redirect',
) {
  const emailProvider = { send: jest.fn().mockResolvedValue({ messageId: 'message-123' }) };
  const emailQueue = {
    enqueue: jest
      .fn()
      .mockImplementation((message: { to: string }) =>
        Promise.resolve({ jobId: 'job-123', recipient: message.to }),
      ),
  };
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'app') return { environment, frontendUrl: 'http://localhost:3000' };
      if (key === 'email') {
        return { deliveryMode, developmentRecipient: 'phase14@merotelecom.test' };
      }
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  return {
    service: new NotificationService(
      emailProvider as EmailProvider,
      emailQueue as never,
      configService as never,
    ),
    emailProvider,
    emailQueue,
  };
}

describe('NotificationService', () => {
  const invoice = {
    invoiceNumber: 'INV-2026-000003',
    dueDate: new Date('2026-08-27T00:00:00.000Z'),
    totalCents: 6900,
    currency: 'AUD',
    customer: {
      firstName: 'Anika',
      lastName: '<Singh>',
      email: 'customer@merotelecom.test',
    },
  };

  it('redirects development email and attaches the authoritative invoice PDF', async () => {
    const { service, emailProvider } = createService();
    const pdf = Buffer.from('%PDF test');

    await expect(service.sendInvoice(invoice, pdf)).resolves.toEqual({
      recipient: 'phase14@merotelecom.test',
      messageId: 'message-123',
    });
    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'phase14@merotelecom.test',
        subject: 'Mero Telecom invoice INV-2026-000003',
        html: expect.stringContaining('Anika &lt;Singh&gt;'),
        attachments: [
          {
            filename: 'INV-2026-000003.pdf',
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      }),
    );
  });

  it('uses the customer address only in production', () => {
    const { service } = createService('production');
    expect(service.invoiceRecipient('customer@merotelecom.test')).toBe('customer@merotelecom.test');
  });

  it('uses the customer-entered address in direct development mode', async () => {
    const { service, emailQueue } = createService('development', 'direct');

    await service.sendAccountInvitation({
      customerName: 'Maya Patel',
      customerEmail: 'dynamic-customer@example.com',
      activationUrl: 'http://localhost:3000/activate?token=single-use-token',
      expiresAt: new Date('2026-08-22T00:00:00.000Z'),
      reason: 'ONLINE_PURCHASE',
      invitationId: 'invitation-id',
    });

    expect(emailQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dynamic-customer@example.com' }),
      { purpose: 'ACCOUNT_INVITATION', invitationId: 'invitation-id' },
      'account-invitation-invitation-id',
    );
  });

  it('queues a password-free activation email through the safe development recipient', async () => {
    const { service, emailQueue } = createService();

    await service.sendAccountInvitation({
      customerName: 'Maya Patel',
      customerEmail: 'maya@example.com',
      activationUrl: 'http://localhost:3000/activate?token=single-use-token',
      expiresAt: new Date('2026-08-22T00:00:00.000Z'),
      reason: 'ONLINE_PURCHASE',
      invitationId: 'invitation-id',
    });

    expect(emailQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'phase14@merotelecom.test',
        subject: 'Activate your Mero Telecom account',
        html: expect.stringContaining('single-use-token'),
      }),
      { purpose: 'ACCOUNT_INVITATION', invitationId: 'invitation-id' },
      'account-invitation-invitation-id',
    );
    expect(JSON.stringify(emailQueue.enqueue.mock.calls)).not.toContain('password=');
  });

  it('queues a deterministic plan-change email with billing details', async () => {
    const { service, emailQueue } = createService('development', 'direct');

    await service.sendPlanChangeNotification({
      event: 'APPLIED',
      planChangeRequestId: 'plan-change-id',
      customerName: 'Maya <Patel>',
      customerEmail: 'maya@example.com',
      oldPlanName: 'Essential 50',
      newPlanName: 'Family 100',
      amountCents: 1500,
      currency: 'AUD',
      effectiveAt: new Date('2026-08-16T12:00:00.000Z'),
      nextBillingAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(emailQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'maya@example.com',
        subject: 'Mero Telecom plan change confirmed',
        text: expect.stringContaining('Amount paid: $15.00'),
        html: expect.stringContaining('Maya &lt;Patel&gt;'),
      }),
      { purpose: 'PLAN_CHANGE_APPLIED', planChangeRequestId: 'plan-change-id' },
      'plan-change-plan-change-id-applied',
    );
  });

  it('queues password reset and password-changed messages through the encrypted email queue', async () => {
    const { service, emailQueue } = createService('development', 'direct');
    const expiresAt = new Date('2026-08-29T12:30:00.000Z');

    await service.sendPasswordReset({
      displayName: 'Maya <Patel>',
      email: 'maya@example.com',
      resetUrl: 'http://localhost:3000/reset-password?token=raw-token',
      expiresAt,
      passwordResetTokenId: 'reset-id',
    });
    await service.sendPasswordChanged({
      displayName: 'Maya <Patel>',
      email: 'maya@example.com',
      userId: 'user-id',
      passwordResetTokenId: 'reset-id',
    });

    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'maya@example.com',
        subject: 'Reset your Mero Telecom password',
        html: expect.stringContaining('Maya &lt;Patel&gt;'),
      }),
      { purpose: 'PASSWORD_RESET', passwordResetTokenId: 'reset-id' },
      'password-reset-reset-id',
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ subject: 'Your Mero Telecom password was changed' }),
      { purpose: 'PASSWORD_CHANGED', userId: 'user-id' },
      'password-changed-reset-id',
    );
  });
});
