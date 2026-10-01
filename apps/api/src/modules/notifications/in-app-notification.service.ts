import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationSeverity, Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { buildPaginationMeta } from '../../common/pagination';
import { PrismaService } from '../../database/prisma.service';
import type { NotificationQueryDto } from './dto/notification.dto';

export const notificationTypes = [
  'GENERAL',
  'INVOICE_CREATED',
  'INVOICE_DUE',
  'INVOICE_OVERDUE',
  'INVOICE_PAID',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_UPDATED',
  'PLAN_UPGRADE_COMPLETED',
  'PLAN_DOWNGRADE_SCHEDULED',
  'PLAN_DOWNGRADE_COMPLETED',
  'PLAN_CHANGE_FAILED',
  'PLAN_CHANGE_REVIEW_REQUIRED',
  'ACTIVATION_REVIEW_REQUIRED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_REVIEW_REQUIRED',
  'ACCOUNT_SETUP_REQUIRED',
  'CANCELLATION_REQUESTED',
  'CANCELLATION_REVIEW_REQUIRED',
  'CANCELLATION_SCHEDULED',
  'CANCELLATION_FAILED',
  'REFUND_REQUESTED',
  'REFUND_APPROVED',
  'REFUND_REJECTED',
  'REFUND_PROCESSED',
  'RELOCATION_REQUESTED',
  'RELOCATION_UPDATED',
  'RELOCATION_ACTION_REQUIRED',
  'RELOCATION_PROVISIONING',
  'INSTALLATION_REQUIRED',
  'RELOCATION_COMPLETED',
  'RELOCATION_FAILED',
  'SUPPORT_REQUEST_CREATED',
  'SUPPORT_REPLY',
  'SUPPORT_ESCALATED',
  'SUPPORT_RESOLVED',
  'SERVICE_SUSPENSION_WARNING',
  'SERVICE_SUSPENDED',
  'SERVICE_RESTORED',
  'PASSWORD_CHANGED',
  'PROFILE_UPDATED',
  'PROVISIONING_COMPLETED',
  'PROVISIONING_UPDATED',
  'PROVISIONING_FAILED',
  'SERVICE_DELAYED',
  'SERVICE_STATE_CHANGE_FAILED',
  'PAYMENT_REVIEW_REQUIRED',
  'COVERAGE_REVIEW_REQUIRED',
  'PAYMENT_REMINDER',
  'FINAL_PAYMENT_WARNING',
  'OPERATIONAL_ACTION_REQUIRED',
  'ADMIN_ACTION',
] as const;

export interface CreateInAppNotificationInput {
  userId: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  actionUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  deduplicationKey?: string | null;
}

const notificationSelect = {
  id: true,
  type: true,
  severity: true,
  title: true,
  message: true,
  isRead: true,
  readAt: true,
  actionUrl: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class InAppNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(input: CreateInAppNotificationInput) {
    await this.assertRecipientsExist([input.userId]);
    const data = this.prepare(input);
    const inserted = await this.prisma.notification.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return this.findCreated(data.id);
    if (data.deduplicationKey) {
      const existing = await this.prisma.notification.findFirst({
        where: { userId: data.userId, deduplicationKey: data.deduplicationKey },
        select: notificationSelect,
      });
      if (existing) return existing;
    }
    throw new BadRequestException('The notification could not be created.');
  }

  async createMany(inputs: readonly CreateInAppNotificationInput[]) {
    if (inputs.length === 0) return { createdCount: 0 };
    await this.assertRecipientsExist(inputs.map((input) => input.userId));
    const result = await this.prisma.notification.createMany({
      data: inputs.map((input) => this.prepare(input)),
      skipDuplicates: true,
    });
    return { createdCount: result.count };
  }

  async createForUsers(
    userIds: readonly string[],
    input: Omit<CreateInAppNotificationInput, 'userId'>,
  ) {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return { createdCount: 0 };
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, isActive: true, status: 'ACTIVE' },
      select: { id: true },
    });
    return this.createMany(recipients.map(({ id }) => ({ ...input, userId: id })));
  }

  async createForRoles(
    roles: readonly Role[],
    input: Omit<CreateInAppNotificationInput, 'userId'>,
  ) {
    const recipients = await this.prisma.user.findMany({
      where: {
        isActive: true,
        status: 'ACTIVE',
        roles: { some: { role: { in: [...new Set(roles)] } } },
      },
      select: { id: true },
    });
    return this.createMany(recipients.map(({ id }) => ({ ...input, userId: id })));
  }

  async getUserNotifications(userId: string, query: NotificationQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.status === 'unread'
        ? { isRead: false }
        : query.status === 'read'
          ? { isRead: true }
          : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { message: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(query, total) };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markAsRead(notificationId: string, userId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
    if (updated.count !== 1) throw new NotFoundException('Notification not found.');
    return this.findOwned(notificationId, userId);
  }

  async markAllAsRead(userId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updatedCount: updated.count };
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const deleted = await this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    if (deleted.count !== 1) throw new NotFoundException('Notification not found.');
  }

  async resolveActionRequired(entityType: string, entityId: string) {
    const resolvedAt = new Date();
    const updated = await this.prisma.notification.updateMany({
      where: {
        entityType,
        entityId,
        severity: NotificationSeverity.ACTION_REQUIRED,
        isRead: false,
      },
      data: { isRead: true, readAt: resolvedAt },
    });
    return { updatedCount: updated.count };
  }

  private async assertRecipientsExist(userIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(userIds)];
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (recipients.length !== uniqueIds.length) {
      throw new NotFoundException('Notification recipient not found.');
    }
  }

  private prepare(
    input: CreateInAppNotificationInput,
  ): Prisma.NotificationCreateManyInput & { id: string } {
    const type = this.requiredText(input.type, 'Notification type', 80);
    if (!/^[A-Z][A-Z0-9_]*$/.test(type)) {
      throw new BadRequestException('Notification type must use upper snake case.');
    }
    return {
      id: randomUUID(),
      userId: input.userId,
      type,
      severity: input.severity,
      title: this.requiredText(input.title, 'Notification title', 160),
      message: this.requiredText(input.message, 'Notification message', 1000),
      actionUrl: this.safeActionUrl(input.actionUrl),
      entityType: this.optionalText(input.entityType, 'Entity type', 100),
      entityId: this.optionalText(input.entityId, 'Entity ID', 255),
      deduplicationKey: this.optionalText(
        input.deduplicationKey,
        'Notification deduplication key',
        190,
      ),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
  }

  private safeActionUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    if (
      value.length > 500 ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32)
    ) {
      throw new BadRequestException('Notification actions must use a safe internal route.');
    }
    const parsed = new URL(value, 'https://notifications.merotelecom.invalid');
    if (parsed.origin !== 'https://notifications.merotelecom.invalid') {
      throw new BadRequestException('Notification actions must use a safe internal route.');
    }
    return parsed.pathname + parsed.search + parsed.hash;
  }

  private requiredText(value: string, label: string, maxLength: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
      throw new BadRequestException(label + ' is invalid.');
    }
    return normalized;
  }

  private optionalText(
    value: string | null | undefined,
    label: string,
    maxLength: number,
  ): string | null {
    if (!value) return null;
    return this.requiredText(value, label, maxLength);
  }

  private async findCreated(id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      select: notificationSelect,
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    return notification;
  }

  private async findOwned(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: notificationSelect,
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    return notification;
  }
}
