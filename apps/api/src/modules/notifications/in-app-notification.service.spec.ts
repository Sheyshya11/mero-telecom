import { NotificationSeverity, Role } from '@prisma/client';

import { NotificationQueryDto } from './dto/notification.dto';
import { InAppNotificationService } from './in-app-notification.service';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
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
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(notification()),
      findFirst: jest.fn().mockResolvedValue(notification()),
      findMany: jest.fn().mockResolvedValue([notification()]),
      count: jest.fn().mockResolvedValue(1),
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
