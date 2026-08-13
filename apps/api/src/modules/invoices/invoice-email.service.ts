import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationService } from '../notifications/notification.service';
import { InvoicePdfService, type InvoicePdfData } from './invoice-pdf.service';

export interface InvoiceEmailDeliveryResult {
  invoiceId: string;
  invoiceNumber: string;
  recipient: string;
  status: 'sent' | 'already_sent';
  sentAt: Date;
}

@Injectable()
export class InvoiceEmailService {
  private readonly inFlight = new Map<string, Promise<InvoiceEmailDeliveryResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly notifications: NotificationService,
  ) {}

  async send(invoiceId: string, actor: AuthenticatedUser): Promise<InvoiceEmailDeliveryResult> {
    const existingOperation = this.inFlight.get(invoiceId);
    if (existingOperation) return existingOperation;

    const operation = this.deliver(invoiceId, actor);
    this.inFlight.set(invoiceId, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(invoiceId);
    }
  }

  private async deliver(
    invoiceId: string,
    actor: AuthenticatedUser,
  ): Promise<InvoiceEmailDeliveryResult> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        subscription: { include: { plan: true } },
        items: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        'Only active issued, overdue, or paid invoices can be emailed.',
      );
    }

    const recipient = this.notifications.invoiceRecipient(invoice.customer.email);
    const previousDelivery = await this.prisma.auditLog.findFirst({
      where: {
        action: 'INVOICE_EMAIL_SENT',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: { path: ['recipient'], equals: recipient },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (previousDelivery) {
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        recipient,
        status: 'already_sent',
        sentAt: previousDelivery.createdAt,
      };
    }

    const pdf = await this.invoicePdf.render(invoice as InvoicePdfData);
    let delivery: { recipient: string; messageId: string };
    try {
      delivery = await this.notifications.sendInvoice(invoice, pdf);
    } catch {
      throw new ServiceUnavailableException('Invoice email could not be sent. Please try again.');
    }

    const audit = await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: 'INVOICE_EMAIL_SENT',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: {
          recipient: delivery.recipient,
          providerMessageId: delivery.messageId,
        },
      },
      select: { createdAt: true },
    });
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      recipient: delivery.recipient,
      status: 'sent',
      sentAt: audit.createdAt,
    };
  }
}
