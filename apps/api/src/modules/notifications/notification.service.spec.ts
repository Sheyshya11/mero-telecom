import type { AppConfig } from '../../config/configuration';
import { NotificationSeverity, Role } from '@prisma/client';
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
  const inApp = {
    createNotification: jest.fn().mockResolvedValue({ id: 'notification-id' }),
    createForRoles: jest.fn().mockResolvedValue({ createdCount: 1 }),
    createForUsers: jest.fn().mockResolvedValue({ createdCount: 1 }),
  };
  const configService = {
    getOrThrow: jest.fn((key: keyof AppConfig) => {
      if (key === 'app') return { environment, frontendUrl: 'http://localhost:3000' };
      if (key === 'email') {
        return {
          deliveryMode,
          developmentRecipient: 'phase14@merotelecom.test',
          opsAlertRecipient: 'support-ops@merotelecom.test',
        };
      }
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };
  return {
    service: new NotificationService(
      emailProvider as EmailProvider,
      emailQueue as never,
      configService as never,
      inApp as never,
    ),
    emailProvider,
    emailQueue,
    inApp,
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
    const { service, emailQueue, inApp } = createService('development', 'direct');
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
    expect(inApp.createNotification).toHaveBeenCalledWith({
      userId: 'user-id',
      type: 'PASSWORD_CHANGED',
      severity: NotificationSeverity.INFO,
      title: 'Password changed',
      message: 'Your Mero Telecom account password was changed successfully.',
      actionUrl: '/account/security',
      entityType: 'User',
      entityId: 'user-id',
      metadata: {
        category: 'SECURITY',
        priority: 'HIGH',
        currentSessionRetained: false,
      },
      deduplicationKey: 'password-changed-reset-id',
    });
  });

  it('queues escaped support updates for customers and the staff queue', async () => {
    const { service, emailQueue } = createService('development', 'direct');

    await service.sendNewSupportCase({
      supportCaseId: 'support-case-id',
      caseNumber: 'SUP-2026-00001',
      userId: 'customer-user-id',
      customerName: 'Maya <Patel>',
      customerEmail: 'maya@example.com',
      subject: 'Router <offline>',
    });
    await service.sendSupportCustomerUpdate({
      event: 'WAITING_FOR_CUSTOMER',
      supportCaseId: 'support-case-id',
      caseNumber: 'SUP-2026-00001',
      userId: 'customer-user-id',
      customerName: 'Maya <Patel>',
      customerEmail: 'maya@example.com',
    });

    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'support-ops@merotelecom.test',
        html: expect.stringContaining('Maya &lt;Patel&gt;'),
      }),
      { purpose: 'SUPPORT_NEW_CASE', supportCaseId: 'SUP-2026-00001' },
      'support-SUP-2026-00001-new',
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: 'maya@example.com',
        subject: 'More information is needed for SUP-2026-00001',
      }),
      { purpose: 'SUPPORT_WAITING_FOR_CUSTOMER', supportCaseId: 'SUP-2026-00001' },
      expect.stringContaining('support-SUP-2026-00001-waiting_for_customer-'),
    );
  });

  it('queues private Internal Request notifications only to Staff and Admin recipients', async () => {
    const { service, emailQueue } = createService('development', 'direct');

    await service.sendNewInternalRequest({
      internalRequestId: 'internal-request-id',
      requestNumber: 'IR-2026-00042',
      requesterName: 'Maya <Patel>',
      type: 'REFUND_REVIEW',
      priority: 'HIGH',
    });
    await service.sendInternalRequestStaffUpdate({
      event: 'MORE_INFO_REQUIRED',
      requestNumber: 'IR-2026-00042',
      staffName: 'Maya <Patel>',
      staffEmail: 'staff@example.com',
    });
    await service.sendAssignedInternalRequestReply({
      requestNumber: 'IR-2026-00042',
      adminEmail: 'admin@example.com',
      resumedReview: true,
    });
    await service.sendInternalRequestSuperAdminUpdate({
      event: 'ESCALATED',
      requestNumber: 'IR-2026-00042',
      superAdminEmail: 'super-admin@example.com',
      priority: 'HIGH',
    });
    await service.sendInternalRequestAdminEscalationUpdate({
      event: 'RETURNED',
      requestNumber: 'IR-2026-00042',
      adminEmail: 'admin@example.com',
    });

    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: 'support-ops@merotelecom.test',
        html: expect.stringContaining('Maya &lt;Patel&gt;'),
      }),
      { purpose: 'INTERNAL_REQUEST_NEW', internalRequestId: 'IR-2026-00042' },
      'internal-request-IR-2026-00042-new',
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: 'staff@example.com',
        subject: 'More information required · IR-2026-00042',
      }),
      { purpose: 'INTERNAL_REQUEST_MORE_INFO_REQUIRED', internalRequestId: 'IR-2026-00042' },
      expect.stringContaining('internal-request-IR-2026-00042-more_info_required-'),
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Staff replied to IR-2026-00042',
        text: expect.stringContaining('back in review'),
      }),
      { purpose: 'INTERNAL_REQUEST_STAFF_REPLIED', internalRequestId: 'IR-2026-00042' },
      expect.stringContaining('internal-request-IR-2026-00042-staff-replied-'),
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        to: 'super-admin@example.com',
        subject: 'High priority: New escalation · IR-2026-00042',
      }),
      { purpose: 'INTERNAL_REQUEST_SUPER_ADMIN_ESCALATED', internalRequestId: 'IR-2026-00042' },
      expect.stringContaining('internal-request-IR-2026-00042-super-admin-escalated-'),
    );
    expect(emailQueue.enqueue).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        to: 'admin@example.com',
        subject: 'Returned to Admin · IR-2026-00042',
      }),
      { purpose: 'INTERNAL_REQUEST_RETURNED', internalRequestId: 'IR-2026-00042' },
      expect.stringContaining('internal-request-IR-2026-00042-admin-returned-'),
    );
  });

  it('routes a customer refund request to the customer and the Admin review queue', async () => {
    const { service, inApp } = createService('development', 'direct');

    await service.sendRefundRequested({
      refundId: 'refund-id',
      userId: 'customer-user-id',
      operationalReviewRequired: true,
      customerName: 'Maya Patel',
      customerEmail: 'maya@example.com',
      invoiceNumber: 'INV-2026-00001',
      originalAmountCents: 6900,
      refundAmountCents: 6900,
      currency: 'AUD',
      reason: 'SERVICE_ISSUE',
      processedAt: new Date('2026-09-30T00:00:00.000Z'),
    });

    expect(inApp.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'customer-user-id',
        type: 'REFUND_REQUESTED',
        severity: NotificationSeverity.INFO,
        actionUrl: '/customer/refunds',
      }),
    );
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN, Role.SUPER_ADMIN],
      expect.objectContaining({
        type: 'REFUND_REQUESTED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/refunds/refund-id',
      }),
    );
  });

  it('routes relocation updates to customers and only the responsible operational roles', async () => {
    const { service, inApp } = createService('development', 'direct');
    const relocation = {
      relocationRequestId: 'relocation-id',
      userId: 'customer-user-id',
      customerName: 'Maya Patel',
      customerEmail: 'maya@example.com',
      oldAddress: '1 Old Street',
      newAddress: '2 New Street',
      planName: 'Family 100',
      requestedMoveDate: new Date('2026-10-20T00:00:00.000Z'),
    };

    await service.sendRelocationNotification({ event: 'REQUESTED', ...relocation });
    await service.sendRelocationNotification({ event: 'FAILED', ...relocation });

    expect(inApp.createForRoles).toHaveBeenNthCalledWith(
      1,
      [Role.STAFF, Role.ADMIN],
      expect.objectContaining({
        type: 'RELOCATION_REQUESTED',
        actionUrl: '/control-centre/relocations/relocation-id',
      }),
    );
    expect(inApp.createNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'RELOCATION_FAILED',
        severity: NotificationSeverity.WARNING,
        message: 'There is an issue with your service relocation.',
      }),
    );
    expect(JSON.stringify(inApp.createNotification.mock.calls)).not.toContain('provider');
    expect(inApp.createForRoles).toHaveBeenNthCalledWith(
      2,
      [Role.ADMIN, Role.SUPER_ADMIN],
      expect.objectContaining({ type: 'RELOCATION_FAILED' }),
    );

    await service.sendRelocationActionRequired({
      relocationRequestId: 'relocation-id',
      idempotencyKey: 'qualification-attempt',
    });
    expect(inApp.createForRoles).toHaveBeenNthCalledWith(
      3,
      [Role.ADMIN],
      expect.objectContaining({
        type: 'RELOCATION_ACTION_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/relocations/relocation-id',
      }),
    );
  });

  it('routes only manual plan-change failures to the Admin work queue', async () => {
    const { service, inApp } = createService('development', 'direct');
    const input = {
      event: 'FAILED' as const,
      planChangeRequestId: 'plan-change-id',
      customerName: 'Maya Patel',
      customerEmail: 'maya@example.com',
      oldPlanName: 'Family 50',
      newPlanName: 'Family 100',
      amountCents: 2000,
      currency: 'AUD',
      effectiveAt: new Date('2026-10-01T00:00:00.000Z'),
      nextBillingAt: new Date('2026-11-01T00:00:00.000Z'),
      userId: 'customer-user-id',
      changeType: 'UPGRADE' as const,
    };

    await service.sendPlanChangeNotification({ ...input, manualReviewRequired: false });
    expect(inApp.createForRoles).not.toHaveBeenCalled();

    await service.sendPlanChangeNotification({ ...input, manualReviewRequired: true });
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN],
      expect.objectContaining({
        type: 'PLAN_CHANGE_REVIEW_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/services',
      }),
    );
  });

  it('routes support creation to the customer and shared Staff queue', async () => {
    const { service, inApp } = createService('development', 'direct');

    await service.sendNewSupportCase({
      supportCaseId: 'support-case-id',
      caseNumber: 'SUP-2026-00001',
      userId: 'customer-user-id',
      customerName: 'Maya Patel',
      customerEmail: 'maya@example.com',
      subject: 'Router offline',
    });

    expect(inApp.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'customer-user-id',
        type: 'SUPPORT_REQUEST_CREATED',
        severity: NotificationSeverity.INFO,
      }),
    );
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.STAFF],
      expect.objectContaining({
        type: 'SUPPORT_REQUEST_CREATED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/support/SUP-2026-00001',
      }),
    );
  });

  it('keeps successful payments customer-only and escalates provisioning failures', async () => {
    const { service, inApp } = createService('development', 'direct');

    await service.sendPaymentSucceeded({
      paymentId: 'payment-id',
      userId: 'customer-user-id',
      amountCents: 6900,
      currency: 'AUD',
      idempotencyKey: 'stripe-event-id',
    });
    expect(inApp.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAYMENT_SUCCESS',
        message: 'Your payment of $69.00 was received successfully.',
      }),
    );
    expect(inApp.createForRoles).not.toHaveBeenCalled();

    await service.sendProvisioningResult({
      subscriptionId: 'subscription-id',
      provisioningRequestId: 'provisioning-id',
      userId: 'customer-user-id',
      action: 'ACTIVATE',
      succeeded: false,
    });

    expect(inApp.createForUsers).toHaveBeenCalledWith(
      ['customer-user-id'],
      expect.objectContaining({
        type: 'SERVICE_DELAYED',
        message: "We're currently resolving an issue affecting your service activation.",
      }),
    );
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN, Role.SUPER_ADMIN],
      expect.objectContaining({
        type: 'PROVISIONING_FAILED',
        severity: NotificationSeverity.ACTION_REQUIRED,
      }),
    );
  });

  it('distinguishes invoice settlement, payment review, and service-state failures', async () => {
    const { service, inApp } = createService('development', 'direct');

    await service.sendInvoicePaid({
      invoiceId: 'invoice-id',
      userId: 'customer-user-id',
      idempotencyKey: 'stripe-invoice-event',
    });
    expect(inApp.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'INVOICE_PAID',
        severity: NotificationSeverity.SUCCESS,
        actionUrl: '/customer/invoices',
      }),
    );

    await service.sendPaymentReviewRequired({
      invoiceId: 'invoice-id',
      idempotencyKey: 'stripe-invoice-id',
    });
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN],
      expect.objectContaining({
        type: 'PAYMENT_REVIEW_REQUIRED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/invoices',
      }),
    );

    inApp.createForRoles.mockClear();
    inApp.createForUsers.mockClear();
    await service.sendProvisioningResult({
      subscriptionId: 'subscription-id',
      provisioningRequestId: 'suspension-request-id',
      userId: 'customer-user-id',
      action: 'SUSPEND',
      succeeded: false,
    });
    expect(inApp.createForUsers).not.toHaveBeenCalled();
    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN],
      expect.objectContaining({
        type: 'SERVICE_STATE_CHANGE_FAILED',
        severity: NotificationSeverity.ACTION_REQUIRED,
      }),
    );
  });

  it('routes cancellation failures to operational roles even without an ops mailbox', async () => {
    const { service, inApp } = createService('development', 'direct');

    await service.sendCancellationOperationalAlert({
      cancellationRequestId: 'cancellation-id',
      requestNumber: 'CAN-2026-00001',
      customerName: 'Maya Patel',
      planName: 'Family 100',
      reason: 'Provider details must stay out of in-app copy.',
      providerSimulated: false,
    });

    expect(inApp.createForRoles).toHaveBeenCalledWith(
      [Role.ADMIN, Role.SUPER_ADMIN],
      expect.objectContaining({
        type: 'CANCELLATION_FAILED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        actionUrl: '/control-centre/cancellations?request=CAN-2026-00001',
        message: 'A service cancellation could not be completed automatically.',
      }),
    );
    expect(JSON.stringify(inApp.createForRoles.mock.calls)).not.toContain('Provider details');
  });
});
