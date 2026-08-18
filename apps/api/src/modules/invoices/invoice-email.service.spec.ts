import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { NotificationService } from '../notifications/notification.service';
import { InvoiceEmailService } from './invoice-email.service';
import type { InvoiceDocumentService } from './invoice-document.service';

const actor: AuthenticatedUser = {
  id: '24ebce68-aa71-47eb-854b-25471c63ce47',
  email: 'admin@merotelecom.test',
  role: Role.ADMIN,
};
const sentAt = new Date('2026-08-13T08:00:00.000Z');
const invoice = {
  id: '0904ecac-56f9-44d4-a805-f4caa399549a',
  invoiceNumber: 'INV-2026-000003',
  status: InvoiceStatus.ISSUED,
  dueDate: new Date('2026-08-27T00:00:00.000Z'),
  totalCents: 6900,
  currency: 'AUD',
  customer: {
    firstName: 'Anika',
    lastName: 'Singh',
    email: 'customer@merotelecom.test',
  },
  subscription: { plan: { name: 'Essential 50' } },
  items: [],
};

function createService(options?: {
  status?: InvoiceStatus;
  previousDelivery?: { createdAt: Date } | null;
  sendError?: Error;
}) {
  const currentInvoice = { ...invoice, status: options?.status ?? invoice.status };
  const prisma = {
    invoice: { findUnique: jest.fn().mockResolvedValue(currentInvoice) },
    auditLog: {
      findFirst: jest.fn().mockResolvedValue(options?.previousDelivery ?? null),
      create: jest.fn().mockResolvedValue({ createdAt: sentAt }),
    },
  };
  const invoiceDocuments = { getOrCreate: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
  const notifications = {
    invoiceRecipient: jest.fn().mockReturnValue('phase14@merotelecom.test'),
    sendInvoice: options?.sendError
      ? jest.fn().mockRejectedValue(options.sendError)
      : jest.fn().mockResolvedValue({
          recipient: 'phase14@merotelecom.test',
          messageId: 'message-123',
        }),
  };
  return {
    service: new InvoiceEmailService(
      prisma as unknown as PrismaService,
      invoiceDocuments as unknown as InvoiceDocumentService,
      notifications as unknown as NotificationService,
    ),
    prisma,
    invoiceDocuments,
    notifications,
  };
}

describe('InvoiceEmailService', () => {
  it('sends an invoice once and records an auditable delivery', async () => {
    const { service, prisma, invoiceDocuments, notifications } = createService();

    await expect(service.send(invoice.id, actor)).resolves.toEqual({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      recipient: 'phase14@merotelecom.test',
      status: 'sent',
      sentAt,
    });
    expect(invoiceDocuments.getOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: invoice.id }),
    );
    expect(notifications.sendInvoice).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: actor.id,
          action: 'INVOICE_EMAIL_SENT',
          entityId: invoice.id,
        }),
      }),
    );
  });

  it('returns the recorded delivery instead of sending the same invoice twice', async () => {
    const { service, notifications, invoiceDocuments } = createService({
      previousDelivery: { createdAt: sentAt },
    });

    await expect(service.send(invoice.id, actor)).resolves.toEqual(
      expect.objectContaining({ status: 'already_sent', sentAt }),
    );
    expect(notifications.sendInvoice).not.toHaveBeenCalled();
    expect(invoiceDocuments.getOrCreate).not.toHaveBeenCalled();
  });

  it('does not email draft or cancelled invoices', async () => {
    const { service, notifications } = createService({ status: InvoiceStatus.CANCELLED });
    await expect(service.send(invoice.id, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(notifications.sendInvoice).not.toHaveBeenCalled();
  });

  it('returns a safe service error and does not record a failed delivery', async () => {
    const { service, prisma } = createService({ sendError: new Error('SMTP credential detail') });
    await expect(service.send(invoice.id, actor)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
