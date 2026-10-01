import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationSeverity, Role, type AccountInvitationReason } from '@prisma/client';

import type { AppConfig } from '../../config/configuration';
import {
  InAppNotificationService,
  type CreateInAppNotificationInput,
} from './in-app-notification.service';
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
import {
  renderOverdueEmail,
  type OverdueEmailData,
  type OverdueEmailEvent,
} from './templates/overdue-email.template';
import {
  renderRelocationEmail,
  type RelocationEmailEvent,
} from './templates/relocation-email.template';

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

type RefundNotificationInput = RefundEmailData & {
  customerEmail: string;
  userId?: string | null;
  operationalReviewRequired?: boolean;
};

type InAppPayload = Omit<CreateInAppNotificationInput, 'userId'>;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly emailQueue: EmailQueueService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Optional() private readonly inApp?: InAppNotificationService,
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
    userId?: string | null;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderSubscriptionConfirmationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
    });
    if (input.userId) {
      await this.recordInApp({
        userId: input.userId,
        type: 'SUBSCRIPTION_ACTIVATED',
        severity: NotificationSeverity.SUCCESS,
        title: 'Service activated',
        message: 'Your Mero Telecom service is now active.',
        actionUrl: '/customer/subscription',
        entityType: 'CheckoutApplication',
        entityId: input.checkoutApplicationId,
        deduplicationKey: 'subscription-activated-' + input.checkoutApplicationId,
      });
    }
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
    userId?: string | null;
    changeType?: 'UPGRADE' | 'DOWNGRADE';
    manualReviewRequired?: boolean;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderPlanChangeEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/subscription`,
    });
    if (input.userId && input.event === 'APPLIED' && input.changeType === 'UPGRADE') {
      await this.recordInApp({
        userId: input.userId,
        type: 'PLAN_UPGRADE_COMPLETED',
        severity: NotificationSeverity.SUCCESS,
        title: 'Plan upgraded',
        message: 'Your new plan is now active.',
        actionUrl: '/customer/subscription',
        entityType: 'PlanChangeRequest',
        entityId: input.planChangeRequestId,
        deduplicationKey: 'plan-upgrade-completed-' + input.planChangeRequestId,
      });
    }
    if (input.userId && input.event === 'SCHEDULED' && input.changeType === 'DOWNGRADE') {
      await this.recordInApp({
        userId: input.userId,
        type: 'PLAN_DOWNGRADE_SCHEDULED',
        severity: NotificationSeverity.INFO,
        title: 'Plan change scheduled',
        message: 'Your new plan will begin on ' + this.formatDate(input.effectiveAt) + '.',
        actionUrl: '/customer/subscription',
        entityType: 'PlanChangeRequest',
        entityId: input.planChangeRequestId,
        deduplicationKey: 'plan-downgrade-scheduled-' + input.planChangeRequestId,
      });
    }
    if (input.userId && input.event === 'APPLIED' && input.changeType === 'DOWNGRADE') {
      await this.recordInApp({
        userId: input.userId,
        type: 'PLAN_DOWNGRADE_COMPLETED',
        severity: NotificationSeverity.SUCCESS,
        title: 'Plan changed',
        message: 'Your scheduled plan change has been completed.',
        actionUrl: '/customer/subscription',
        entityType: 'PlanChangeRequest',
        entityId: input.planChangeRequestId,
        deduplicationKey: 'plan-downgrade-completed-' + input.planChangeRequestId,
      });
    }
    if (input.userId && input.event === 'FAILED') {
      await this.recordInApp({
        userId: input.userId,
        type: 'PLAN_CHANGE_FAILED',
        severity: NotificationSeverity.WARNING,
        title: 'Plan change unsuccessful',
        message: "We couldn't complete your requested plan change.",
        actionUrl: '/customer/subscription',
        entityType: 'PlanChangeRequest',
        entityId: input.planChangeRequestId,
        deduplicationKey: 'plan-change-failed-' + input.planChangeRequestId,
      });
    }
    if (input.event === 'FAILED' && input.manualReviewRequired) {
      const scheduledDowngrade = input.changeType === 'DOWNGRADE';
      await this.recordForRoles([Role.ADMIN], {
        type: scheduledDowngrade ? 'PLAN_CHANGE_FAILED' : 'PLAN_CHANGE_REVIEW_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: scheduledDowngrade
          ? 'Scheduled plan change failed'
          : 'Plan change requires attention',
        message: scheduledDowngrade
          ? 'A scheduled customer plan change requires attention.'
          : 'A customer plan change could not be completed automatically.',
        actionUrl: '/control-centre/services',
        entityType: 'PlanChangeRequest',
        entityId: input.planChangeRequestId,
        deduplicationKey: 'plan-change-review-' + input.planChangeRequestId,
      });
    }
    const purpose = `PLAN_CHANGE_${input.event}` as const;
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose, planChangeRequestId: input.planChangeRequestId },
      `plan-change-${input.planChangeRequestId}-${input.event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendRelocationNotification(input: {
    event: RelocationEmailEvent;
    relocationRequestId: string;
    customerName: string;
    customerEmail: string;
    oldAddress: string;
    newAddress: string;
    planName: string;
    requestedMoveDate: Date;
    failureReason?: string | null;
    userId?: string | null;
    installationRequired?: boolean | null;
    appointmentRequired?: boolean | null;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderRelocationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/subscription/moving-home`,
    });
    if (input.userId) {
      const customerDetails: Partial<
        Record<
          RelocationEmailEvent,
          { type: string; severity: NotificationSeverity; title: string; message: string }
        >
      > = {
        REQUESTED: {
          type: 'RELOCATION_REQUESTED',
          severity: NotificationSeverity.INFO,
          title: 'Relocation request received',
          message: "We've received your request to move your service.",
        },
        CONFIRMED: {
          type:
            input.installationRequired || input.appointmentRequired
              ? 'INSTALLATION_REQUIRED'
              : 'RELOCATION_PROVISIONING',
          severity:
            input.installationRequired || input.appointmentRequired
              ? NotificationSeverity.ACTION_REQUIRED
              : NotificationSeverity.INFO,
          title:
            input.installationRequired || input.appointmentRequired
              ? 'Installation required'
              : 'New service being prepared',
          message:
            input.installationRequired || input.appointmentRequired
              ? 'An installation or appointment is required at your new address.'
              : "We're preparing your service at your new address.",
        },
        SCHEDULED: {
          type: 'RELOCATION_PROVISIONING',
          severity: NotificationSeverity.INFO,
          title: 'New service being prepared',
          message: "We're preparing your service at your new address.",
        },
        COMPLETED: {
          type: 'RELOCATION_COMPLETED',
          severity: NotificationSeverity.SUCCESS,
          title: 'Relocation completed',
          message: 'Your service relocation has been completed.',
        },
        FAILED: {
          type: 'RELOCATION_FAILED',
          severity: NotificationSeverity.WARNING,
          title: 'Relocation delayed',
          message: 'There is an issue with your service relocation.',
        },
      };
      const details = customerDetails[input.event];
      if (details) {
        await this.recordInApp({
          userId: input.userId,
          ...details,
          actionUrl: '/customer/subscription/moving-home',
          entityType: 'ServiceRelocation',
          entityId: input.relocationRequestId,
          deduplicationKey:
            'relocation-' + input.relocationRequestId + '-' + input.event.toLowerCase(),
        });
      }
    }
    if (input.event === 'REQUESTED') {
      await this.recordForRoles([Role.STAFF, Role.ADMIN], {
        type: 'RELOCATION_REQUESTED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'New relocation request',
        message: 'A customer has requested a service relocation.',
        actionUrl: '/control-centre/relocations/' + input.relocationRequestId,
        entityType: 'ServiceRelocation',
        entityId: input.relocationRequestId,
        deduplicationKey: 'relocation-review-' + input.relocationRequestId,
      });
    }
    if (input.event === 'FAILED') {
      await this.recordForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
        type: 'RELOCATION_FAILED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'Relocation failed',
        message: 'A relocation requires operational attention.',
        actionUrl: '/control-centre/relocations/' + input.relocationRequestId,
        entityType: 'ServiceRelocation',
        entityId: input.relocationRequestId,
        deduplicationKey: 'relocation-failed-operations-' + input.relocationRequestId,
      });
    }
    const purpose = `RELOCATION_${input.event}` as const;
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose, relocationRequestId: input.relocationRequestId },
      `relocation-${input.relocationRequestId}-${input.event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendRelocationActionRequired(input: {
    relocationRequestId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.recordForRoles([Role.ADMIN], {
      type: 'RELOCATION_ACTION_REQUIRED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Relocation requires attention',
      message: 'A relocation could not continue automatically.',
      actionUrl: '/control-centre/relocations/' + input.relocationRequestId,
      entityType: 'ServiceRelocation',
      entityId: input.relocationRequestId,
      deduplicationKey:
        'relocation-action-' + input.relocationRequestId + '-' + input.idempotencyKey,
    });
  }

  async sendOverdueLifecycleNotification(
    input: Omit<OverdueEmailData, 'event' | 'brandLogoUrl' | 'dashboardUrl'> & {
      event: OverdueEmailEvent;
      subscriptionId: string;
      customerEmail: string;
      idempotencySuffix: string;
      actionUrl?: string | null;
      userId?: string | null;
      invoiceId?: string;
    },
  ): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderOverdueEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      dashboardUrl:
        input.actionUrl ?? `${this.configService.getOrThrow('app').frontendUrl}/customer/dashboard`,
    });
    if (input.userId) {
      const customerDetails: Partial<
        Record<
          OverdueEmailEvent,
          { type: string; severity: NotificationSeverity; title: string; message: string }
        >
      > = {
        PAYMENT_FAILED: {
          type: 'PAYMENT_FAILED',
          severity: NotificationSeverity.ACTION_REQUIRED,
          title: 'Payment failed',
          message: "We couldn't process your payment. Please review your payment method.",
        },
        PAYMENT_AUTHENTICATION_REQUIRED: {
          type: 'PAYMENT_FAILED',
          severity: NotificationSeverity.ACTION_REQUIRED,
          title: 'Payment needs your approval',
          message: 'Please complete the required payment authentication.',
        },
        SERVICE_SUSPENDED: {
          type: 'SERVICE_SUSPENDED',
          severity: NotificationSeverity.CRITICAL,
          title: 'Service suspended',
          message: 'Your internet service has been suspended.',
        },
        SERVICE_RESTORATION_REQUESTED: {
          type: 'SERVICE_RESTORED',
          severity: NotificationSeverity.SUCCESS,
          title: 'Service restored',
          message: 'Your internet service has been restored.',
        },
        PAYMENT_RECEIVED: {
          type: 'INVOICE_PAID',
          severity: NotificationSeverity.SUCCESS,
          title: 'Invoice paid',
          message: 'Your invoice has been paid successfully.',
        },
      };
      const details = customerDetails[input.event];
      if (details) {
        await this.recordInApp({
          userId: input.userId,
          ...details,
          actionUrl: '/customer/invoices',
          entityType: 'Invoice',
          entityId: input.invoiceId ?? input.invoiceNumber,
          deduplicationKey:
            'lifecycle-' +
            input.subscriptionId +
            '-' +
            input.event.toLowerCase() +
            '-' +
            input.idempotencySuffix,
        });
      }
    }
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: input.event, subscriptionId: input.subscriptionId },
      `overdue-${input.subscriptionId}-${input.idempotencySuffix}`,
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
    cancellationType: 'END_OF_PERIOD' | 'IMMEDIATE';
    refundAmountCents: number;
    refundStatus: string | null;
    userId?: string | null;
    cancellationRequestId: string;
  }): Promise<InvoiceEmailResult> {
    const recipient = this.invoiceRecipient(input.customerEmail);
    const template = renderCancellationEmail({
      ...input,
      brandLogoUrl: this.brandLogoUrl(),
      dashboardUrl: `${this.configService.getOrThrow('app').frontendUrl}/customer/subscription`,
    });
    const details: Partial<
      Record<
        CancellationEmailEvent,
        { type: string; severity: NotificationSeverity; title: string; message: string }
      >
    > = {
      REQUESTED: {
        type: 'CANCELLATION_REQUESTED',
        severity: NotificationSeverity.INFO,
        title: 'Cancellation request received',
        message: "We've received your cancellation request.",
      },
      SCHEDULED: {
        type: 'CANCELLATION_SCHEDULED',
        severity: NotificationSeverity.WARNING,
        title: 'Service cancellation scheduled',
        message:
          'Your service is scheduled to be cancelled on ' +
          this.formatDate(input.effectiveAt) +
          '.',
      },
      COMPLETED: {
        type: 'SUBSCRIPTION_CANCELLED',
        severity: NotificationSeverity.INFO,
        title: 'Service cancelled',
        message: 'Your service has been cancelled.',
      },
    };
    const inAppDetails = details[input.event];
    if (input.userId && inAppDetails) {
      await this.recordInApp({
        userId: input.userId,
        ...inAppDetails,
        actionUrl: '/customer/subscription',
        entityType: 'CancellationRequest',
        entityId: input.cancellationRequestId,
        deduplicationKey:
          'cancellation-' + input.cancellationRequestId + '-' + input.event.toLowerCase(),
      });
    }
    const purpose = `CANCELLATION_${input.event}` as const;
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose, cancellationRequestId: input.requestNumber },
      `cancellation-${input.requestNumber}-${input.event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendCancellationOperationalAlert(input: {
    cancellationRequestId: string;
    requestNumber: string;
    customerName: string;
    planName: string;
    reason: string;
    providerSimulated: boolean;
  }): Promise<InvoiceEmailResult | null> {
    await this.recordForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
      type: 'CANCELLATION_FAILED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Cancellation processing failed',
      message: 'A service cancellation could not be completed automatically.',
      actionUrl: '/control-centre/cancellations?request=' + encodeURIComponent(input.requestNumber),
      entityType: 'CancellationRequest',
      entityId: input.cancellationRequestId,
      deduplicationKey: 'cancellation-failed-' + input.cancellationRequestId,
    });
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
    passwordResetTokenId?: string;
    eventId?: string;
    currentSessionRetained?: boolean;
  }): Promise<InvoiceEmailResult> {
    const eventId = input.eventId ?? input.passwordResetTokenId;
    if (!eventId) throw new Error('A password-change event ID is required.');
    const recipient = this.invoiceRecipient(input.email);
    const template = renderPasswordChangedEmail({ ...input, brandLogoUrl: this.brandLogoUrl() });
    await this.recordInApp({
      userId: input.userId,
      type: 'PASSWORD_CHANGED',
      severity: NotificationSeverity.INFO,
      title: 'Password changed',
      message: 'Your Mero Telecom account password was changed successfully.',
      actionUrl: '/account/security',
      entityType: 'User',
      entityId: input.userId,
      metadata: {
        category: 'SECURITY',
        priority: 'HIGH',
        currentSessionRetained: input.currentSessionRetained ?? false,
      },
      deduplicationKey: 'password-changed-' + eventId,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'PASSWORD_CHANGED', userId: input.userId },
      `password-changed-${eventId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  sendRefundRequested(input: RefundNotificationInput) {
    return this.sendRefundNotification(input, 'REQUESTED');
  }

  sendRefundMoreInformation(input: RefundNotificationInput) {
    return this.sendRefundNotification(input, 'MORE_INFORMATION_REQUIRED');
  }

  sendRefundApproved(input: RefundNotificationInput) {
    return this.sendRefundNotification(input, 'APPROVED');
  }

  sendRefundRejected(input: RefundNotificationInput) {
    return this.sendRefundNotification(input, 'REJECTED');
  }

  sendRefundSucceeded(input: RefundNotificationInput) {
    return this.sendRefundNotification(input, 'SUCCEEDED');
  }

  sendRefundFailed(input: RefundNotificationInput) {
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

  async sendInvoiceCreated(input: {
    invoiceId: string;
    invoiceNumber: string;
    userId?: string | null;
  }): Promise<void> {
    if (!input.userId) return;
    await this.recordInApp({
      userId: input.userId,
      type: 'INVOICE_CREATED',
      severity: NotificationSeverity.INFO,
      title: 'New invoice available',
      message: 'Your new invoice is ready.',
      actionUrl: '/customer/invoices',
      entityType: 'Invoice',
      entityId: input.invoiceId,
      deduplicationKey: 'invoice-created-' + input.invoiceId,
    });
  }

  async sendPaymentSucceeded(input: {
    paymentId: string;
    userId?: string | null;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!input.userId) return;
    await this.recordInApp({
      userId: input.userId,
      type: 'PAYMENT_SUCCESS',
      severity: NotificationSeverity.SUCCESS,
      title: 'Payment successful',
      message:
        'Your payment of ' +
        this.formatMoney(input.amountCents, input.currency) +
        ' was received successfully.',
      actionUrl: '/customer/invoices',
      entityType: 'Payment',
      entityId: input.paymentId,
      deduplicationKey: 'payment-success-' + input.idempotencyKey,
    });
  }

  async sendInvoicePaid(input: {
    invoiceId: string;
    userId?: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    if (!input.userId) return;
    await this.recordInApp({
      userId: input.userId,
      type: 'INVOICE_PAID',
      severity: NotificationSeverity.SUCCESS,
      title: 'Invoice paid',
      message: 'Your invoice has been paid successfully.',
      actionUrl: '/customer/invoices',
      entityType: 'Invoice',
      entityId: input.invoiceId,
      deduplicationKey: 'invoice-paid-' + input.idempotencyKey,
    });
  }

  async sendPaymentReviewRequired(input: {
    invoiceId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.recordForRoles([Role.ADMIN], {
      type: 'PAYMENT_REVIEW_REQUIRED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Payment requires attention',
      message: 'A customer payment issue requires manual review.',
      actionUrl: '/control-centre/invoices',
      entityType: 'Invoice',
      entityId: input.invoiceId,
      deduplicationKey: 'payment-review-' + input.idempotencyKey,
    });
  }

  async sendProfileUpdated(input: { userId: string; eventId: string }): Promise<void> {
    await this.recordInApp({
      userId: input.userId,
      type: 'PROFILE_UPDATED',
      severity: NotificationSeverity.INFO,
      title: 'Account details updated',
      message: 'Your account information was recently updated.',
      actionUrl: '/customer/profile',
      entityType: 'User',
      entityId: input.userId,
      deduplicationKey: 'profile-updated-' + input.eventId,
    });
  }

  async sendProvisioningResult(input: {
    subscriptionId: string;
    provisioningRequestId: string;
    userId?: string | null;
    action: 'ACTIVATE' | 'SUSPEND' | 'RESTORE';
    succeeded: boolean;
  }): Promise<void> {
    if (input.succeeded && input.userId) {
      const details =
        input.action === 'SUSPEND'
          ? {
              type: 'SERVICE_SUSPENDED',
              severity: NotificationSeverity.CRITICAL,
              title: 'Service suspended',
              message: 'Your internet service has been suspended.',
            }
          : input.action === 'RESTORE'
            ? {
                type: 'SERVICE_RESTORED',
                severity: NotificationSeverity.SUCCESS,
                title: 'Service restored',
                message: 'Your internet service has been restored.',
              }
            : {
                type: 'PROVISIONING_COMPLETED',
                severity: NotificationSeverity.SUCCESS,
                title: 'Service ready',
                message: 'Your service has been successfully provisioned.',
              };
      await this.recordInApp({
        userId: input.userId,
        ...details,
        actionUrl: '/customer/subscription',
        entityType: 'Subscription',
        entityId: input.subscriptionId,
        deduplicationKey: 'provisioning-success-' + input.provisioningRequestId,
      });
      return;
    }
    if (input.succeeded) return;
    if (input.action === 'ACTIVATE') {
      const customerNotification: InAppPayload = {
        type: 'SERVICE_DELAYED',
        severity: NotificationSeverity.WARNING,
        title: 'Service activation delayed',
        message: "We're currently resolving an issue affecting your service activation.",
        actionUrl: '/customer/subscription',
        entityType: 'Subscription',
        entityId: input.subscriptionId,
        deduplicationKey: 'service-delayed-' + input.provisioningRequestId,
      };
      await Promise.all([
        input.userId
          ? this.recordForUsers([input.userId], customerNotification)
          : Promise.resolve(),
        this.recordForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
          type: 'PROVISIONING_FAILED',
          severity: NotificationSeverity.ACTION_REQUIRED,
          title: 'Provisioning failure',
          message: 'A customer service could not be provisioned automatically.',
          actionUrl: '/control-centre/services',
          entityType: 'Subscription',
          entityId: input.subscriptionId,
          deduplicationKey: 'provisioning-failed-' + input.provisioningRequestId,
        }),
      ]);
      return;
    }
    await this.recordForRoles([Role.ADMIN], {
      type: 'SERVICE_STATE_CHANGE_FAILED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Service update failed',
      message: "A customer's service state could not be updated automatically.",
      actionUrl: '/control-centre/services',
      entityType: 'Subscription',
      entityId: input.subscriptionId,
      deduplicationKey: 'service-state-change-failed-' + input.provisioningRequestId,
    });
  }

  async sendActivationReviewRequired(input: {
    checkoutApplicationId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.recordForRoles([Role.ADMIN], {
      type: 'ACTIVATION_REVIEW_REQUIRED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Activation requires attention',
      message: 'A customer service activation could not be completed automatically.',
      actionUrl: '/control-centre/services',
      entityType: 'CheckoutApplication',
      entityId: input.checkoutApplicationId,
      deduplicationKey: 'activation-review-' + input.idempotencyKey,
    });
  }

  async sendScheduledPlanChangeFailure(input: { planChangeRequestId: string }): Promise<void> {
    await this.recordForRoles([Role.ADMIN], {
      type: 'PLAN_CHANGE_FAILED',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Scheduled plan change failed',
      message: 'A scheduled customer plan change requires attention.',
      actionUrl: '/control-centre/services',
      entityType: 'PlanChangeRequest',
      entityId: input.planChangeRequestId,
      deduplicationKey: 'scheduled-plan-change-failed-' + input.planChangeRequestId,
    });
  }

  async resolveActionRequired(entityType: string, entityId: string): Promise<void> {
    if (!this.inApp) return;
    try {
      await this.inApp.resolveActionRequired(entityType, entityId);
    } catch (error: unknown) {
      this.logInAppFailure(error);
    }
  }

  async sendNewSupportCase(input: {
    supportCaseId: string;
    caseNumber: string;
    userId: string;
    customerName: string;
    customerEmail: string;
    subject: string;
  }): Promise<InvoiceEmailResult | null> {
    await Promise.all([
      this.recordInApp({
        userId: input.userId,
        type: 'SUPPORT_REQUEST_CREATED',
        severity: NotificationSeverity.INFO,
        title: 'Support request created',
        message: 'Your support request has been submitted.',
        actionUrl: '/customer/support/' + input.caseNumber,
        entityType: 'SupportCase',
        entityId: input.supportCaseId,
        deduplicationKey: 'support-created-customer-' + input.supportCaseId,
      }),
      this.recordForRoles([Role.STAFF], {
        type: 'SUPPORT_REQUEST_CREATED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'New support request',
        message: 'A new customer support request requires attention.',
        actionUrl: '/control-centre/support/' + input.caseNumber,
        entityType: 'SupportCase',
        entityId: input.supportCaseId,
        deduplicationKey: 'support-created-queue-' + input.supportCaseId,
      }),
    ]);
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
    staffUserId: string;
    caseNumber: string;
    staffEmail: string;
    supportCaseId: string;
    supportMessageId: string;
  }): Promise<InvoiceEmailResult> {
    await this.recordInApp({
      userId: input.staffUserId,
      type: 'SUPPORT_REPLY',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Customer replied',
      message: 'A customer replied to a support request assigned to you.',
      actionUrl: '/control-centre/support/' + input.caseNumber,
      entityType: 'SupportCase',
      entityId: input.supportCaseId,
      deduplicationKey: 'support-customer-reply-' + input.supportMessageId,
    });
    const recipient = this.invoiceRecipient(input.staffEmail);
    const template = renderAssignedSupportReplyEmail({
      brandLogoUrl: this.brandLogoUrl(),
      caseNumber: input.caseNumber,
      supportUrl: `${this.configService.getOrThrow('app').frontendUrl}/control-centre/support/${input.caseNumber}`,
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: 'SUPPORT_CUSTOMER_REPLIED', supportCaseId: input.caseNumber },
      `support-${input.caseNumber}-customer-reply-${input.supportMessageId}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  async sendSupportCustomerUpdate(input: {
    event: SupportCustomerEvent;
    userId: string;
    supportCaseId: string;
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
    const details =
      input.event === 'RESOLVED'
        ? {
            type: 'SUPPORT_RESOLVED',
            severity: NotificationSeverity.SUCCESS,
            title: 'Support request resolved',
            message: 'Your support request has been marked as resolved.',
          }
        : input.event === 'WAITING_FOR_CUSTOMER'
          ? {
              type: 'SUPPORT_REPLY',
              severity: NotificationSeverity.ACTION_REQUIRED,
              title: 'More information required',
              message: 'The support team needs more information from you.',
            }
          : {
              type: 'SUPPORT_REPLY',
              severity: NotificationSeverity.INFO,
              title: 'New support response',
              message: 'A support team member replied to your request.',
            };
    await this.recordInApp({
      userId: input.userId,
      ...details,
      actionUrl: '/customer/support/' + input.caseNumber,
      entityType: 'SupportCase',
      entityId: input.supportCaseId,
      deduplicationKey:
        'support-customer-' +
        input.event.toLowerCase() +
        '-' +
        (input.supportMessageId ?? input.supportCaseId),
    });
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      {
        purpose: `SUPPORT_${input.event}`,
        supportCaseId: input.caseNumber,
        supportMessageId: input.supportMessageId,
      },
      `support-${input.caseNumber}-${input.event.toLowerCase()}-${input.supportMessageId ?? 'status'}`,
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
    internalRequestId: string;
    requestNumber: string;
    requesterName: string;
    type: string;
    priority: string;
    supportCaseNumber?: string | null;
    customerUserId?: string | null;
  }): Promise<InvoiceEmailResult | null> {
    const isSupportEscalation = Boolean(input.supportCaseNumber);
    await Promise.all([
      this.recordForRoles([Role.ADMIN], {
        type: isSupportEscalation ? 'SUPPORT_ESCALATED' : 'OPERATIONAL_ACTION_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: isSupportEscalation
          ? 'Support request escalated'
          : 'Internal request requires review',
        message: isSupportEscalation
          ? 'A support request has been escalated for Admin review.'
          : 'A Staff request requires Admin review.',
        actionUrl: '/control-centre/internal-requests/' + input.requestNumber,
        entityType: 'InternalRequest',
        entityId: input.internalRequestId,
        deduplicationKey: 'internal-request-admin-review-' + input.internalRequestId,
      }),
      input.customerUserId && input.supportCaseNumber
        ? this.recordForUsers([input.customerUserId], {
            type: 'SUPPORT_ESCALATED',
            severity: NotificationSeverity.INFO,
            title: 'Support request escalated',
            message: 'Your support request has been escalated for further review.',
            actionUrl: '/customer/support/' + input.supportCaseNumber,
            entityType: 'InternalRequest',
            entityId: input.internalRequestId,
            deduplicationKey: 'support-escalated-customer-' + input.internalRequestId,
          })
        : Promise.resolve(),
    ]);
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
    internalRequestId?: string;
    userId?: string;
    supportCaseNumber?: string | null;
    requestNumber: string;
    superAdminEmail: string;
    priority?: string;
  }): Promise<InvoiceEmailResult> {
    if (input.event === 'ESCALATED' && input.userId && input.internalRequestId) {
      await this.recordForUsers([input.userId], {
        type: input.supportCaseNumber ? 'SUPPORT_ESCALATED' : 'OPERATIONAL_ACTION_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: input.supportCaseNumber ? 'Support request escalated' : 'Request escalated',
        message: input.supportCaseNumber
          ? 'An Admin has escalated a support request requiring your attention.'
          : 'An Admin escalation requires your attention.',
        actionUrl: '/control-centre/internal-requests/' + input.requestNumber,
        entityType: 'InternalRequest',
        entityId: input.internalRequestId,
        deduplicationKey: 'internal-request-super-admin-' + input.internalRequestId,
      });
    }
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
    input: RefundNotificationInput,
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
    const inAppDetails: Partial<
      Record<
        typeof event,
        { type: string; severity: NotificationSeverity; title: string; message: string }
      >
    > = {
      REQUESTED: {
        type: 'REFUND_REQUESTED',
        severity: NotificationSeverity.INFO,
        title: 'Refund request submitted',
        message: 'Your refund request has been submitted and is awaiting review.',
      },
      APPROVED: {
        type: 'REFUND_APPROVED',
        severity: NotificationSeverity.SUCCESS,
        title: 'Refund approved',
        message: 'Your refund request has been approved.',
      },
      REJECTED: {
        type: 'REFUND_REJECTED',
        severity: NotificationSeverity.WARNING,
        title: 'Refund request declined',
        message: 'Your refund request was not approved.',
      },
      SUCCEEDED: {
        type: 'REFUND_PROCESSED',
        severity: NotificationSeverity.SUCCESS,
        title: 'Refund processed',
        message: 'Your refund has been processed successfully.',
      },
    };
    const details = inAppDetails[event];
    if (input.userId && details) {
      await this.recordInApp({
        userId: input.userId,
        ...details,
        actionUrl: '/customer/refunds',
        entityType: 'Refund',
        entityId: input.refundId,
        deduplicationKey: 'refund-' + input.refundId + '-' + event.toLowerCase(),
      });
    }
    if (event === 'REQUESTED' && input.operationalReviewRequired) {
      await this.recordForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
        type: 'REFUND_REQUESTED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'New refund request',
        message: 'A customer refund request requires review.',
        actionUrl: '/control-centre/refunds/' + input.refundId,
        entityType: 'Refund',
        entityId: input.refundId,
        deduplicationKey: 'refund-review-' + input.refundId,
      });
    }
    if (event === 'FAILED') {
      await this.recordForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
        type: 'OPERATIONAL_ACTION_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'Refund processing requires attention',
        message: 'A customer refund could not be processed automatically.',
        actionUrl: '/control-centre/refunds/' + input.refundId,
        entityType: 'Refund',
        entityId: input.refundId,
        deduplicationKey: 'refund-processing-failed-' + input.refundId,
      });
    }
    const result = await this.emailQueue.enqueue(
      { to: recipient, ...template },
      { purpose: `REFUND_${event}`, refundId: input.refundId },
      `refund-${input.refundId}-${event.toLowerCase()}`,
    );
    return { recipient, messageId: `queued:${result.jobId}` };
  }

  private async recordInApp(input: CreateInAppNotificationInput): Promise<void> {
    if (!this.inApp) return;
    try {
      await this.inApp.createNotification(input);
    } catch (error: unknown) {
      this.logger.warn(
        JSON.stringify({
          event: 'in_app_notification_failed',
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private async recordForRoles(roles: readonly Role[], input: InAppPayload): Promise<void> {
    if (!this.inApp) return;
    try {
      await this.inApp.createForRoles(roles, input);
    } catch (error: unknown) {
      this.logInAppFailure(error);
    }
  }

  private async recordForUsers(userIds: readonly string[], input: InAppPayload): Promise<void> {
    if (!this.inApp) return;
    try {
      await this.inApp.createForUsers(userIds, input);
    } catch (error: unknown) {
      this.logInAppFailure(error);
    }
  }

  private logInAppFailure(error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'in_app_notification_failed',
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
  }

  private formatDate(value: Date): string {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Australia/Adelaide',
    }).format(value);
  }

  private formatMoney(amountCents: number, currency: string): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
    }).format(amountCents / 100);
  }

  private brandLogoUrl(): string {
    return new URL(
      MERO_TELECOM_LOGO_PATH,
      this.configService.getOrThrow('app').frontendUrl,
    ).toString();
  }
}
