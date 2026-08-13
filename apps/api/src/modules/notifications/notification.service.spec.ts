import type { AppConfig } from '../../config/configuration';
import type { EmailProvider } from './email-provider';
import { NotificationService } from './notification.service';

function createService(environment = 'development') {
  const emailProvider = { send: jest.fn().mockResolvedValue({ messageId: 'message-123' }) };
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'app') return { environment };
      if (key === 'email') return { developmentRecipient: 'phase14@merotelecom.test' };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  return {
    service: new NotificationService(emailProvider as EmailProvider, configService as never),
    emailProvider,
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
});
