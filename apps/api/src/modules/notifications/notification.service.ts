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
import { renderRefundEmail, type RefundEmailData } from './templates/refund-email.template';
import {
  renderAssignedSupportReplyEmail,
  renderNewProspectEnquiryEmail,
  renderNewSupportCaseEmail,
  renderProspectEnquiryReceiptEmail,
  renderProspectSupportEmail,
  renderSupportCustomerEmail,
  type SupportCustomerEvent,
} from './templates/support-email.template';
import {
  renderAssignedInternalRequestReplyEmail,
  renderInternalRequestAdminEscalationEmail,
  renderInternalRequestStaffEmail,
  renderInternalRequestSuperAdminEmail,
  renderNewInternalRequestEmail,
  type InternalRequestAdminEscalationEvent,
  type InternalRequestStaffEvent,
  type InternalRequestSuperAdminEvent,
} from './templates/internal-request-email.template';
import { MERO_TELECOM_LOGO_PATH } from './templates/email-brand';
import {
  renderCancellationEmail,
  renderCancellationOperationalAlert,
  type CancellationEmailEvent,
} from './templates/cancellation-email.template';

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
    const template = renderAccountInvitationEmail({ ...input, brandLogoUrl: this.brandLogoUrl() });
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
    const template = renderStaffInvitationEmail({ ...input, brandLogoUrl: this.brandLogoUrl() });
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
    const template = renderSubscriptionConfirmationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
    });
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
      brandLogoUrl: this.brandLogoUrl(),
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

  async sendCancellationNotification(input: {
    event: CancellationEmailEvent;
    requestNumber: string;
    customerName: string;
    customerEmail: string;
    planName: string;
    effectiveAt: Date;
    providerOperation: 'DISCONNECT_SERVICE' | 'WITHDRAW_ACTIVATION';
    providerSimulated: boolean;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderCancellationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/subscription`,
    });
    const purpose = `CANCELLATION_${input.event}` as const;
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose, cancellationRequestId: input.requestNumber },
      `cancellation-${input.requestNumber}-${input.event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendCancellationOperationalAlert(input: {
    requestNumber: string;
    customerName: string;
    planName: string;
    reason: string;
    providerSimulated: boolean;
  }): Promise<InvoiceEmailResult | null> {
    const configuredRecipient = this.configService.getOrThrow('email').opsAlertRecipient;
    if (!configuredRecipient) return null;
    const recipient = this.invoiceRecipient(configuredRecipient);
    const operationsUrl = `${this.configService.getOrThrow('app').frontendUrl}/control-centre/cancellations?request=${encodeURIComponent(input.requestNumber)}`;
    const template = renderCancellationOperationalAlert({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      operationsUrl,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'CANCELLATION_OPERATIONAL_ALERT', cancellationRequestId: input.requestNumber },
      `cancellation-${input.requestNumber}-operational-alert`,
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
    const template = renderPasswordResetEmail({ ...input, brandLogoUrl: this.brandLogoUrl() });
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
    const template = renderPasswordChangedEmail({ ...input, brandLogoUrl: this.brandLogoUrl() });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'PASSWORD_CHANGED', userId: input.userId },
      `password-changed-${input.passwordResetTokenId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  sendRefundRequested(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'REQUESTED');
  }

  sendRefundMoreInformation(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'MORE_INFORMATION_REQUIRED');
  }

  sendRefundApproved(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'APPROVED');
  }

  sendRefundRejected(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'REJECTED');
  }

  sendRefundSucceeded(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'SUCCEEDED');
  }

  sendRefundFailed(input: RefundEmailData & { customerEmail: string }) {
    return this.sendRefundNotification(input, 'FAILED');
  }

  async sendRefundReconciliationAlert(input: {
    refundId: string;
    stripeRefundId: string | null;
    reason: string;
  }) {
    const email = this.configService.getOrThrow('email');
    if (!email.opsAlertRecipient) return null;
    const recipient = this.invoiceRecipient(email.opsAlertRecipient);
    const subject = `Refund reconciliation alert: ${input.refundId}`;
    const text = [
      'A Mero Telecom refund requires attention.',
      `Refund ID: ${input.refundId}`,
      `Stripe refund ID: ${input.stripeRefundId ?? 'missing'}`,
      `Reason: ${input.reason}`,
    ].join('\n');
    const result = await this.emailQueue.enqueue(
      {
        to: recipient,
        subject,
        text,
        html: `<p>A Mero Telecom refund requires attention.</p><p><strong>Refund ID:</strong> ${input.refundId}<br/><strong>Stripe refund ID:</strong> ${input.stripeRefundId ?? 'missing'}<br/><strong>Reason:</strong> ${input.reason}</p>`,
      },
      { purpose: 'REFUND_RECONCILIATION_ALERT', refundId: input.refundId },
      `refund-reconciliation-alert-${input.refundId}-${new Date().toISOString().slice(0, 10)}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendInvoice(invoice: InvoiceEmailData, pdf: Buffer): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(invoice.customer.email);
    const template = renderInvoiceEmail({
      brandLogoUrl: this.brandLogoUrl(),
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

  async sendNewSupportCase(input: {
    caseNumber: string;
    customerName: string;
    customerEmail: string;
    subject: string;
  }): Promise<InvoiceEmailResult | null> {
    const configuredRecipient = this.configService.getOrThrow('email').opsAlertRecipient;
    if (!configuredRecipient) return null;
    const recipient = this.invoiceRecipient(configuredRecipient);
    const template = renderNewSupportCaseEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      supportUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/support/${input.caseNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'SUPPORT_NEW_CASE', supportCaseId: input.caseNumber },
      `support-${input.caseNumber}-new`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendAssignedSupportReply(input: {
    caseNumber: string;
    staffEmail: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.staffEmail);
    const template = renderAssignedSupportReplyEmail({
      brandLogoUrl: this.brandLogoUrl(),
      caseNumber: input.caseNumber,
      supportUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/support/${input.caseNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'SUPPORT_CUSTOMER_REPLIED', supportCaseId: input.caseNumber },
      `support-${input.caseNumber}-customer-reply-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendSupportCustomerUpdate(input: {
    event: SupportCustomerEvent;
    caseNumber: string;
    customerName: string;
    customerEmail: string;
    supportMessageId?: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderSupportCustomerEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      supportUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/support/${input.caseNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `SUPPORT_${input.event}`,
        supportCaseId: input.caseNumber,
        supportMessageId: input.supportMessageId,
      },
      `support-${input.caseNumber}-${input.event.toLowerCase()}-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendNewProspectEnquiry(input: {
    caseNumber: string;
    prospectName: string;
    prospectEmail: string;
    subject: string;
    category: string;
  }): Promise<InvoiceEmailResult | null> {
    const configuredRecipient = this.configService.getOrThrow('email').opsAlertRecipient;
    if (!configuredRecipient) return null;
    const recipient = this.invoiceRecipient(configuredRecipient);
    const template = renderNewProspectEnquiryEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      supportUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/support/${input.caseNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'SUPPORT_NEW_PROSPECT_ENQUIRY', supportCaseId: input.caseNumber },
      `support-${input.caseNumber}-new-prospect`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendProspectEnquiryReceipt(input: {
    caseNumber: string;
    prospectName: string;
    prospectEmail: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.prospectEmail);
    const template = renderProspectEnquiryReceiptEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'SUPPORT_PROSPECT_RECEIPT', supportCaseId: input.caseNumber },
      `support-${input.caseNumber}-prospect-receipt`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendProspectSupportUpdate(input: {
    event: SupportCustomerEvent;
    caseNumber: string;
    prospectName: string;
    prospectEmail: string;
    supportMessageId?: string;
    messageBody?: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.prospectEmail);
    const template = renderProspectSupportEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `SUPPORT_PROSPECT_${input.event}`,
        supportCaseId: input.caseNumber,
        supportMessageId: input.supportMessageId,
      },
      `support-${input.caseNumber}-prospect-${input.event.toLowerCase()}-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendNewInternalRequest(input: {
    requestNumber: string;
    requesterName: string;
    type: string;
    priority: string;
  }): Promise<InvoiceEmailResult | null> {
    const configuredRecipient = this.configService.getOrThrow('email').opsAlertRecipient;
    if (!configuredRecipient) return null;
    const recipient = this.invoiceRecipient(configuredRecipient);
    const template = renderNewInternalRequestEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      requestUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/internal-requests/${input.requestNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'INTERNAL_REQUEST_NEW', internalRequestId: input.requestNumber },
      `internal-request-${input.requestNumber}-new`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendInternalRequestStaffUpdate(input: {
    event: InternalRequestStaffEvent;
    requestNumber: string;
    staffName: string;
    staffEmail: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.staffEmail);
    const template = renderInternalRequestStaffEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      requestUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/internal-requests/${input.requestNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `INTERNAL_REQUEST_${input.event}`,
        internalRequestId: input.requestNumber,
      },
      `internal-request-${input.requestNumber}-${input.event.toLowerCase()}-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendAssignedInternalRequestReply(input: {
    requestNumber: string;
    adminEmail: string;
    resumedReview: boolean;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.adminEmail);
    const template = renderAssignedInternalRequestReplyEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      requestUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/internal-requests/${input.requestNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: 'INTERNAL_REQUEST_STAFF_REPLIED',
        internalRequestId: input.requestNumber,
      },
      `internal-request-${input.requestNumber}-staff-replied-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendInternalRequestSuperAdminUpdate(input: {
    event: InternalRequestSuperAdminEvent;
    requestNumber: string;
    superAdminEmail: string;
    priority?: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.superAdminEmail);
    const template = renderInternalRequestSuperAdminEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      requestUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/internal-requests/${input.requestNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `INTERNAL_REQUEST_SUPER_ADMIN_${input.event}`,
        internalRequestId: input.requestNumber,
      },
      `internal-request-${input.requestNumber}-super-admin-${input.event.toLowerCase()}-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendInternalRequestAdminEscalationUpdate(input: {
    event: InternalRequestAdminEscalationEvent;
    requestNumber: string;
    adminEmail: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.adminEmail);
    const template = renderInternalRequestAdminEscalationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      requestUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/internal-requests/${input.requestNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `INTERNAL_REQUEST_${input.event}`,
        internalRequestId: input.requestNumber,
      },
      `internal-request-${input.requestNumber}-admin-${input.event.toLowerCase()}-${Date.now()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  private async sendRefundNotification(
    input: RefundEmailData & { customerEmail: string },
    event:
      | 'REQUESTED'
      | 'MORE_INFORMATION_REQUIRED'
      | 'APPROVED'
      | 'REJECTED'
      | 'SUCCEEDED'
      | 'FAILED',
  ): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderRefundEmail(input, event);
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: `REFUND_${event}`, refundId: input.refundId },
      `refund-${input.refundId}-${event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  private brandLogoUrl(): string {
    return new URL(
      MERO_TELECOM_LOGO_PATH,
      this.configService.getOrThrow('app').frontendUrl,
    ).toString();
  }
}
