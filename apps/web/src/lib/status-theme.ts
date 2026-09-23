const successStatuses = new Set([
  'ACCEPTED',
  'ACTIVE',
  'COMPLETED',
  'CONNECTED',
  'ELIGIBLE',
  'PAID',
  'RESOLVED',
  'SUCCEEDED',
]);

const warningStatuses = new Set([
  'CANCELLATION_PENDING',
  'COMING_SOON',
  'INVITATION_PENDING',
  'ISSUED',
  'PENDING',
  'REQUIRES_REVIEW',
  'SCHEDULED',
  'SUSPENDED',
  'WAITING_FOR_CUSTOMER',
]);

const destructiveStatuses = new Set([
  'CANCELLED',
  'DEACTIVATED',
  'DISABLED',
  'DISCONNECTION_PENDING',
  'EXPIRED',
  'FAILED',
  'OVERDUE',
  'PAST_DUE',
  'REVOKED',
  'TERMINATED',
]);

export function statusToneClass(status: string): string {
  if (successStatuses.has(status)) return 'bg-success-subtle text-success-foreground';
  if (warningStatuses.has(status)) return 'bg-warning-subtle text-warning-foreground';
  if (destructiveStatuses.has(status)) {
    return 'bg-destructive-subtle text-destructive-foreground';
  }
  return 'bg-primary-subtle text-primary';
}
