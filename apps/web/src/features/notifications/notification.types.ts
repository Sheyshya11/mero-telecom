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
  invoiceResolution?: {
    status: 'PAID' | 'CANCELLED';
    invoiceId: string;
    resolvedAt: string;
  };
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
  ['RELOCATION_REVIEW_REQUIRED', 'Moves awaiting review'],
  ['RELOCATION_REJECTED', 'Move home decisions'],
  ['RELOCATION_ACTION_REQUIRED', 'Relocations requiring action'],
  ['INSTALLATION_REQUIRED', 'Installation required'],
  ['RELOCATION_PROVISIONING', 'Relocation provisioning'],
  ['RELOCATION_COMPLETED', 'Completed relocations'],
  ['RELOCATION_FAILED', 'Relocation issues'],
  ['SUPPORT_REPLY', 'Support replies'],
  ['SUPPORT_RESOLVED', 'Resolved support'],
  ['CANCELLATION_REQUESTED', 'Cancellation requests'],
  ['CANCELLATION_REVIEW_REQUIRED', 'Cancellations awaiting review'],
  ['CANCELLATION_APPROVED', 'Approved cancellations'],
  ['CANCELLATION_REJECTED', 'Cancellation decisions'],
  ['CANCELLATION_SCHEDULED', 'Scheduled cancellations'],
  ['CANCELLATION_FAILED', 'Cancellation issues'],
  ['PROVISIONING_COMPLETED', 'Provisioned services'],
  ['PROVISIONING_FAILED', 'Provisioning failures'],
  ['SERVICE_DELAYED', 'Service delays'],
  ['PAYMENT_REMINDER', 'Payment reminders'],
  ['FINAL_PAYMENT_WARNING', 'Final payment notices'],
  ['PAYMENT_GRACE_PERIOD_EXTENDED', 'Payment deadline extensions'],
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

export function notificationDisplay(notification: AppNotification): {
  title: string;
  message: string;
  severity: NotificationSeverity;
} {
  if (!notification.invoiceResolution) return notification;
  const paid = notification.invoiceResolution.status === 'PAID';
  return {
    title: paid ? 'Invoice paid — notice resolved' : 'Invoice cancelled — notice resolved',
    message: paid
      ? 'This invoice has been paid. No further payment is required for this notice.'
      : 'This invoice has been cancelled. No payment is required for this notice.',
    severity: 'INFO',
  };
}

export function collectionNotificationStage(notification: AppNotification): string | null {
  if (notification.invoiceResolution) return null;
  if (notification.type === 'FINAL_PAYMENT_WARNING')
    return notification.metadata &&
      typeof notification.metadata === 'object' &&
      'collectionStage' in notification.metadata &&
      notification.metadata.collectionStage === 'RECOVERY_FINAL_WARNING'
      ? 'RECOVERY_FINAL_WARNING'
      : 'FINAL_WARNING';
  if (notification.type === 'SERVICE_SUSPENDED') return 'SERVICE_SUSPENDED';
  if (notification.type !== 'PAYMENT_REMINDER') return null;
  const metadata = notification.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    'collectionStage' in metadata &&
    typeof metadata.collectionStage === 'string'
  )
    return metadata.collectionStage;
  return 'PAYMENT_REMINDER';
}

export function collectionNotificationLabel(notification: AppNotification): string | null {
  if (notification.invoiceResolution) return 'Resolved';
  switch (collectionNotificationStage(notification)) {
    case 'FIRST_REMINDER':
      return 'First payment reminder';
    case 'SECOND_REMINDER':
      return 'Urgent payment reminder';
    case 'RECOVERY_FINAL_WARNING':
      return 'RECOVERY FINAL NOTICE';
    case 'FINAL_WARNING':
      return 'FINAL NOTICE';
    case 'SERVICE_SUSPENDED':
      return 'SERVICE SUSPENDED';
    case 'MANUAL_REMINDER':
    case 'PAYMENT_REMINDER':
      return 'Payment reminder';
    default:
      return null;
  }
}

export function notificationActionLabel(notification: AppNotification): string {
  if (notification.invoiceResolution || notification.type === 'INVOICE_PAID') return 'View Invoice';
  if (notification.type === 'PAYMENT_GRACE_PERIOD_EXTENDED') return 'Pay Now';
  if (notification.type === 'SERVICE_STATE_CHANGE_FAILED') return 'Review Account';
  const stage = collectionNotificationStage(notification);
  return stage === 'SERVICE_SUSPENDED' ? 'Pay Outstanding Balance' : stage ? 'Pay Now' : 'Open';
}
