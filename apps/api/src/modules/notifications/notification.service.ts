import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import { EmailProvider } from './email-provider';
import { renderInvoiceEmail } from './templates/invoice-email.template';

export interface InvoiceEmailData {
  invoiceNumber: string;
  dueDate: Date;
  totalCents: number;
  currency: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface InvoiceEmailResult {
  recipient: string;
  messageId: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  invoiceRecipient(customerEmail: string): string {
    const environment = this.configService.getOrThrow('app').environment;
    const developmentRecipient = this.configService.getOrThrow('email').developmentRecipient;
    return environment === 'production' ? customerEmail : developmentRecipient;
  }

  async sendInvoice(invoice: InvoiceEmailData, pdf: Buffer): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(invoice.customer.email);
    const template = renderInvoiceEmail({
      invoiceNumber: invoice.invoiceNumber,
      customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
    });
    const result = await this.emailProvider.send({
      to: recipient,
      ...template,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
    return { recipient, messageId: result.messageId };
  }
}
