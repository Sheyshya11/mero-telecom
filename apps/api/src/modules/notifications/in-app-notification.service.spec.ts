import { NotificationSeverity, Role } from '@prisma/client';

import { NotificationQueryDto } from './dto/notification.dto';
import { InAppNotificationService } from './in-app-notification.service';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const paymentId = '55555555-5555-4555-8555-555555555555';
const notificationId = '33333333-3333-4333-8333-333333333333';

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: notificationId,
    type: 'PAYMENT_FAILED',
    severity: NotificationSeverity.ACTION_REQUIRED,
    title: 'Payment failed',
    message: 'Update your payment method.',
    isRead: false,
    readAt: null,
    actionUrl: '/customer/invoices',
    entityType: 'Payment',
    entityId: 'payment-id',
    metadata: null,
    createdAt: new Date('2026-09-30T01:00:00.000Z'),
    updatedAt: new Date('2026-09-30T01:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: userId }]),
    },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(notification()),
      findFirst: jest.fn().mockResolvedValue(notification()),
      findMany: jest.fn().mockResolvedValue([notification()]),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(notification()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    prisma,
    service: new InAppNotificationService(prisma as never),
  };
}

function query(overrides: Partial<NotificationQueryDto> = {}) {
  return Object.assign(new NotificationQueryDto(), overrides);
}

describe('InAppNotificationService', () => {
  it('creates a notification only after verifying the recipient', async () => {
    const { prisma, service } = createService();

    await expect(
      service.createNotification({
        userId,
        type: 'PAYMENT_FAILED',
        severity: NotificationSeverity.ACTION_REQUIRED,
        title: 'Payment failed',
        message: 'Update your payment method.',
        actionUrl: '/customer/invoices?status=overdue',
        entityType: 'Payment',
        entityId: 'payment-id',
        deduplicationKey: 'payment-failed-payment-id',
      }),
    ).resolves.toEqual(notification());

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [userId] } },
      select: { id: true },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId,
          type: 'PAYMENT_FAILED',
          actionUrl: '/customer/invoices?status=overdue',
          deduplicationKey: 'payment-failed-payment-id',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('returns the existing event notification when an idempotency key is repeated', async () => {
    const { prisma, service } = createService();
    prisma.notification.createMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createNotification({
        userId,
        type: 'PAYMENT_SUCCESS',
        severity: NotificationSeverity.SUCCESS,
        title: 'Payment received',
        message: 'Your payment was received.',
        deduplicationKey: 'payment-success-payment-id',
      }),
    ).resolves.toEqual(notification());

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { userId, deduplicationKey: 'payment-success-payment-id' },
      select: expect.any(Object),
    });
  });

  it('refreshes a deduplicated collection retry with the current deadline without creating another notice', async () => {
    const { prisma, service } = createService();
    prisma.notification.createMany.mockResolvedValue({ count: 0 });
    await service.createNotification({
      userId,
      type: 'FINAL_PAYMENT_WARNING',
      severity: NotificationSeverity.CRITICAL,
      title: 'Final payment notice',
      message: 'Service remains active until the revised deadline.',
      deduplicationKey: 'same-recovery',
      refreshExisting: true,
      metadata: { suspensionDate: '2100-01-12' },
    });
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: notificationId },
        data: expect.objectContaining({
          message: 'Service remains active until the revised deadline.',
          metadata: { suspensionDate: '2100-01-12' },
        }),
      }),
    );
    expect(prisma.notification.update.mock.calls[0][0].data).not.toHaveProperty('isRead');
    expect(prisma.notification.update.mock.calls[0][0].data).not.toHaveProperty('createdAt');
  });
  it('rejects external and protocol-relative action URLs', async () => {
    const { prisma, service } = createService();

    await expect(
      service.createNotification({
        userId,
        type: 'GENERAL',
        severity: NotificationSeverity.INFO,
        title: 'Unsafe action',
        message: 'Unsafe action.',
        actionUrl: 'https://malicious.example/path',
      }),
    ).rejects.toThrow('safe internal route');
    await expect(
      service.createNotification({
        userId,
        type: 'GENERAL',
        severity: NotificationSeverity.INFO,
        title: 'Unsafe action',
        message: 'Unsafe action.',
        actionUrl: '//malicious.example/path',
      }),
    ).rejects.toThrow('safe internal route');

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('retrieves only the authenticated user notifications with pagination and filters', async () => {
    const { prisma, service } = createService();

    await expect(
      service.getUserNotifications(
        userId,
        query({
          page: 2,
          limit: 10,
          status: 'unread',
          severity: NotificationSeverity.ACTION_REQUIRED,
          type: 'PAYMENT_FAILED',
          search: 'payment',
        }),
      ),
    ).resolves.toEqual({
      data: [notification()],
      meta: {
        page: 2,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId,
          isRead: false,
          severity: NotificationSeverity.ACTION_REQUIRED,
          type: 'PAYMENT_FAILED',
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(JSON.stringify(prisma.notification.findMany.mock.calls)).not.toContain(otherUserId);
  });

  it.each([
    'INVOICE_CREATED',
    'INVOICE_DUE',
    'INVOICE_OVERDUE',
    'PAYMENT_FAILED',
    'PAYMENT_REMINDER',
    'FINAL_PAYMENT_WARNING',
    'PAYMENT_GRACE_PERIOD_EXTENDED',
    'SERVICE_SUSPENSION_WARNING',
    'SERVICE_SUSPENDED',
  ])(
    'resolves historical %s notices from the confirmed invoice status without marking them read',
    async (type) => {
      const { prisma, service } = createService();
      const original = notification({
        type,
        severity: NotificationSeverity.CRITICAL,
        entityType: 'Invoice',
        entityId: invoiceId,
      });
      prisma.notification.findMany.mockResolvedValue([original]);
      const paidAt = new Date('2026-10-10T01:00:00Z');
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: invoiceId,
          invoiceNumber: 'INV-001',
          status: 'PAID',
          paidAt,
          updatedAt: paidAt,
          payments: [],
        },
      ]);

      const result = await service.getUserNotifications(userId, query());
      expect(result.data).toEqual([
        {
          ...original,
          actionUrl: '/customer/invoices?invoiceId=' + invoiceId,
          invoiceResolution: { status: 'PAID', invoiceId, resolvedAt: paidAt },
        },
      ]);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customer: { userId },
            status: { in: ['PAID', 'CANCELLED'] },
          }),
        }),
      );
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('only resolves the settled invoice in a page and keeps unrelated notices unchanged', async () => {
    const { prisma, service } = createService();
    const notices = [
      notification({
        id: 'paid',
        type: 'FINAL_PAYMENT_WARNING',
        entityType: 'Invoice',
        entityId: invoiceId,
      }),
      notification({
        id: 'unpaid',
        type: 'PAYMENT_REMINDER',
        entityType: 'Invoice',
        entityId: 'INV-UNPAID',
      }),
      notification({
        id: 'support',
        type: 'SUPPORT_REPLY',
        entityType: 'Invoice',
        entityId: invoiceId,
      }),
    ];
    prisma.notification.findMany.mockResolvedValue(notices);
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: invoiceId,
        invoiceNumber: 'INV-001',
        status: 'PAID',
        paidAt: null,
        updatedAt: new Date(),
        payments: [],
      },
    ]);
    const result = await service.getUserNotifications(userId, query());
    expect(result.data[0]).toHaveProperty('invoiceResolution.status', 'PAID');
    expect(result.data[1]).toEqual(notices[1]);
    expect(result.data[2]).toEqual(notices[2]);
    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
  });

  it('leaves overdue, partial, pending, missing and other-customer invoices actionable', async () => {
    const { prisma, service } = createService();
    const original = notification({
      type: 'FINAL_PAYMENT_WARNING',
      entityType: 'Invoice',
      entityId: invoiceId,
    });
    prisma.notification.findMany.mockResolvedValue([original]);
    // None of these invoices match the owner + PAID/CANCELLED database predicate.
    prisma.invoice.findMany.mockResolvedValue([]);
    expect((await service.getUserNotifications(userId, query())).data).toEqual([original]);
    expect(prisma.invoice.findMany.mock.calls[0][0].where).toMatchObject({
      customer: { userId },
      status: { in: ['PAID', 'CANCELLED'] },
    });
  });

  it('supports legacy invoice numbers and cancelled invoices without passing numbers as UUIDs', async () => {
    const { prisma, service } = createService();
    prisma.notification.findMany.mockResolvedValue([
      notification({ type: 'PAYMENT_REMINDER', entityType: 'Invoice', entityId: 'INV-001' }),
    ]);
    const updatedAt = new Date();
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: invoiceId,
        invoiceNumber: 'INV-001',
        status: 'CANCELLED',
        paidAt: null,
        updatedAt,
        payments: [],
      },
    ]);
    expect((await service.getUserNotifications(userId, query())).data[0]).toHaveProperty(
      'invoiceResolution',
      { status: 'CANCELLED', invoiceId, resolvedAt: updatedAt },
    );
    expect(prisma.invoice.findMany.mock.calls[0][0].where.OR).toContainEqual({ id: { in: [] } });
    expect(prisma.invoice.findMany.mock.calls[0][0].where.OR).toContainEqual({
      invoiceNumber: { in: ['INV-001'] },
    });
  });

  it('resolves linked failed payment notices and metadata invoice references in the same query', async () => {
    const { prisma, service } = createService();
    prisma.notification.findMany.mockResolvedValue([
      notification({ id: 'payment', entityId: paymentId }),
      notification({ id: 'metadata', entityType: null, entityId: null, metadata: { invoiceId } }),
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: invoiceId,
        invoiceNumber: 'INV-001',
        status: 'PAID',
        paidAt: new Date(),
        updatedAt: new Date(),
        payments: [{ id: paymentId }],
      },
    ]);
    const result = await service.getUserNotifications(userId, query());
    expect(result.data.every((notice) => 'invoiceResolution' in notice)).toBe(true);
    expect(prisma.invoice.findMany.mock.calls[0][0].where.OR).toContainEqual({
      payments: { some: { id: { in: [paymentId] } } },
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns current settlement state after marking a notice read', async () => {
    const { prisma, service } = createService();
    prisma.notification.findFirst.mockResolvedValue(
      notification({ type: 'FINAL_PAYMENT_WARNING', entityType: 'Invoice', entityId: invoiceId }),
    );
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: invoiceId,
        invoiceNumber: 'INV-001',
        status: 'PAID',
        paidAt: new Date(),
        updatedAt: new Date(),
        payments: [],
      },
    ]);
    expect(await service.markAsRead(notificationId, userId)).toHaveProperty(
      'invoiceResolution.status',
      'PAID',
    );
  });

  it('returns an efficient unread count for the current user', async () => {
    const { prisma, service } = createService();

    await expect(service.getUnreadCount(userId)).resolves.toEqual({ count: 1 });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId, isRead: false },
    });
  });

  it('marks one owned notification as read and blocks another user', async () => {
    const { prisma, service } = createService();

    await expect(service.markAsRead(notificationId, userId)).resolves.toEqual(notification());
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: expect.any(Date) },
    });

    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.markAsRead(notificationId, otherUserId)).rejects.toThrow(
      'Notification not found.',
    );
  });

  it('marks all unread notifications for one user as read', async () => {
    const { prisma, service } = createService();

    await expect(service.markAllAsRead(userId)).resolves.toEqual({ updatedCount: 1 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it('resolves only unread ACTION_REQUIRED notifications for one workflow entity', async () => {
    const { prisma, service } = createService();

    await expect(service.resolveActionRequired('SupportCase', 'support-case-id')).resolves.toEqual({
      updatedCount: 1,
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        entityType: 'SupportCase',
        entityId: 'support-case-id',
        severity: NotificationSeverity.ACTION_REQUIRED,
        isRead: false,
      },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it('deletes an owned notification and blocks unauthorized deletion', async () => {
    const { prisma, service } = createService();

    await expect(service.deleteNotification(notificationId, userId)).resolves.toBeUndefined();
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId },
    });

    prisma.notification.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.deleteNotification(notificationId, otherUserId)).rejects.toThrow(
      'Notification not found.',
    );
  });

  it('validates multiple recipients with one query and inserts in bulk', async () => {
    const { prisma, service } = createService();
    prisma.user.findMany.mockResolvedValue([{ id: userId }, { id: otherUserId }]);
    prisma.notification.createMany.mockResolvedValue({ count: 2 });

    await expect(
      service.createMany(
        [userId, otherUserId].map((recipient) => ({
          userId: recipient,
          type: 'GENERAL',
          severity: NotificationSeverity.INFO,
          title: 'Maintenance update',
          message: 'A service update is available.',
          deduplicationKey: 'maintenance-2026-09-30',
        })),
      ),
    ).resolves.toEqual({ createdCount: 2 });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
  });

  it('selects active recipients by actual RBAC roles', async () => {
    const { prisma, service } = createService();
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: userId }, { id: otherUserId }])
      .mockResolvedValueOnce([{ id: userId }, { id: otherUserId }]);
    prisma.notification.createMany.mockResolvedValue({ count: 2 });

    await service.createForRoles([Role.ADMIN, Role.SUPER_ADMIN], {
      type: 'ADMIN_ACTION',
      severity: NotificationSeverity.WARNING,
      title: 'Review required',
      message: 'An operational review requires attention.',
      actionUrl: '/control-centre/internal-requests',
      deduplicationKey: 'admin-review-request-id',
    });

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        isActive: true,
        status: 'ACTIVE',
        roles: { some: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } } },
      },
      select: { id: true },
    });
  });

  it('targets only active assigned users and ignores duplicate recipient IDs', async () => {
    const { prisma, service } = createService();
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: userId }])
      .mockResolvedValueOnce([{ id: userId }]);

    await service.createForUsers([userId, userId, otherUserId], {
      type: 'SUPPORT_REPLY',
      severity: NotificationSeverity.ACTION_REQUIRED,
      title: 'Customer replied',
      message: 'A customer replied to your assigned support request.',
      actionUrl: '/control-centre/support/SUP-2026-00001',
      deduplicationKey: 'support-reply-message-id',
    });

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: { in: [userId, otherUserId] },
        isActive: true,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId })],
      skipDuplicates: true,
    });
  });
});
