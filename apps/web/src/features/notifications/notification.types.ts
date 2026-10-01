export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' | 'ACTION_REQUIRED';

export interface AppNotification {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPage {
  data: AppNotification[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export const notificationTypeOptions = [
  ['PAYMENT_SUCCESS', 'Payment successful'],
  ['PAYMENT_FAILED', 'Payment failed'],
  ['PAYMENT_REVIEW_REQUIRED', 'Payments requiring review'],
  ['INVOICE_CREATED', 'New invoices'],
  ['INVOICE_PAID', 'Paid invoices'],
  ['SUBSCRIPTION_ACTIVATED', 'Subscription'],
  ['PLAN_UPGRADE_COMPLETED', 'Plan upgrades'],
  ['PLAN_DOWNGRADE_SCHEDULED', 'Plan downgrades'],
  ['PLAN_DOWNGRADE_COMPLETED', 'Completed downgrades'],
  ['PLAN_CHANGE_FAILED', 'Plan change issues'],
  ['REFUND_REQUESTED', 'Refund requests'],
  ['REFUND_APPROVED', 'Refund approvals'],
  ['REFUND_REJECTED', 'Refund decisions'],
  ['REFUND_PROCESSED', 'Processed refunds'],
  ['RELOCATION_REQUESTED', 'Relocations'],
  ['RELOCATION_ACTION_REQUIRED', 'Relocations requiring action'],
  ['INSTALLATION_REQUIRED', 'Installation required'],
  ['RELOCATION_PROVISIONING', 'Relocation provisioning'],
  ['RELOCATION_COMPLETED', 'Completed relocations'],
  ['RELOCATION_FAILED', 'Relocation issues'],
  ['SUPPORT_REPLY', 'Support replies'],
  ['SUPPORT_RESOLVED', 'Resolved support'],
  ['CANCELLATION_REQUESTED', 'Cancellation requests'],
  ['CANCELLATION_SCHEDULED', 'Scheduled cancellations'],
  ['CANCELLATION_FAILED', 'Cancellation issues'],
  ['PROVISIONING_COMPLETED', 'Provisioned services'],
  ['PROVISIONING_FAILED', 'Provisioning failures'],
  ['SERVICE_DELAYED', 'Service delays'],
  ['SERVICE_SUSPENDED', 'Suspended services'],
  ['SERVICE_RESTORED', 'Restored services'],
  ['PROFILE_UPDATED', 'Account updates'],
  ['PASSWORD_CHANGED', 'Account security'],
  ['OPERATIONAL_ACTION_REQUIRED', 'Operational actions'],
] as const;

export function isSafeInternalNotificationAction(value: string | null): value is string {
  return Boolean(
    value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
  );
}

export function notificationSeverityLabel(severity: NotificationSeverity): string {
  return severity.replaceAll('_', ' ');
}

export function formatNotificationTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const seconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, 'day');
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(timestamp));
}
