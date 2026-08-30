import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration';
import { EmailQueueService } from './email-queue.service';
import { EmailProvider } from './email-provider';
import {
  renderAccountInvitationEmail,
  renderStaffInvitationEmail,
  renderSubscriptionConfirmationEmail,
} from './templates/account-email.template';
import { renderInvoiceEmail } from './templates/invoice-email.template';
import {
  renderPlanChangeEmail,
  type PlanChangeEmailEvent,
} from './templates/plan-change-email.template';
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
} from './templates/password-email.template';
import type { AccountInvitationReason } from '@prisma/client';

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
    private readonly emailQueue: EmailQueueService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  invoiceRecipient(customerEmail: string): string {
    const environment = this.configService.getOrThrow('app').environment;
    const email = this.configService.getOrThrow('email');
    return environment === 'production' || email.deliveryMode === 'direct'
      ? customerEmail
      : email.developmentRecipient;
  }

  async sendAccountInvitation(input: {
    customerName: string;
    customerEmail: string;
    activationUrl: string;
    expiresAt: Date;
    reason: AccountInvitationReason;
    invitationId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderAccountInvitationEmail(input);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'ACCOUNT_INVITATION', invitationId: input.invitationId },
      `account-invitation-${input.invitationId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendStaffInvitation(input: {
    displayName: string;
    email: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF';
    activationUrl: string;
    expiresAt: Date;
    invitationId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.email);
    const template = renderStaffInvitationEmail(input);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'STAFF_INVITATION', staffInvitationId: input.invitationId },
      `staff-invitation-${input.invitationId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendSubscriptionConfirmation(input: {
    customerName: string;
    customerEmail: string;
    planName: string;
    invoiceNumber: string;
    totalCents: number;
    currency: string;
    activationPending: boolean;
    checkoutApplicationId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderSubscriptionConfirmationEmail(input);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: 'SUBSCRIPTION_CONFIRMATION',
        checkoutApplicationId: input.checkoutApplicationId,
      },
      `subscription-confirmation-${input.checkoutApplicationId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendPlanChangeNotification(input: {
    event: PlanChangeEmailEvent;
    planChangeRequestId: string;
    customerName: string;
    customerEmail: string;
    oldPlanName: string;
    newPlanName: string;
    amountCents: number;
    currency: string;
    effectiveAt: Date;
    nextBillingAt: Date;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderPlanChangeEmail({
      ...input,
      dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/subscription`,
    });
    const purpose = `PLAN_CHANGE_${input.event}` as const;
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose, planChangeRequestId: input.planChangeRequestId },
      `plan-change-${input.planChangeRequestId}-${input.event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendPasswordReset(input: {
    displayName: string;
    email: string;
    resetUrl: string;
    expiresAt: Date;
    passwordResetTokenId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.email);
    const template = renderPasswordResetEmail(input);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'PASSWORD_RESET', passwordResetTokenId: input.passwordResetTokenId },
      `password-reset-${input.passwordResetTokenId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendPasswordChanged(input: {
    displayName: string;
    email: string;
    userId: string;
    passwordResetTokenId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.email);
    const template = renderPasswordChangedEmail(input);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'PASSWORD_CHANGED', userId: input.userId },
      `password-changed-${input.passwordResetTokenId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
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
