import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import type { CollectionSettings } from './collection-policy.service';

export const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
export type CollectionWarning =
  | 'FIRST_REMINDER'
  | 'SECOND_REMINDER'
  | 'FINAL_WARNING'
  | 'RECOVERY_FINAL_WARNING';
export interface CollectionDeadlineInvoice {
  dueDate: Date;
  originalSuspensionDeadline?: Date | null;
  recoverySuspensionDeadline?: Date | null;
  recoveryFinalWarningSentAt?: Date | null;
  firstReminderSentAt?: Date | null;
  secondReminderSentAt?: Date | null;
  finalWarningSentAt?: Date | null;
  suspensionScheduledAt?: Date | null;
}
export function collectionSettingsFromConfig(
  settings: AppConfig['overdueLifecycle'],
): CollectionSettings {
  return {
    firstReminderDays: settings.firstReminderDays,
    secondReminderDays: settings.secondReminderDays,
    finalWarningDays: settings.finalWarningDays,
    suspensionDays: settings.gracePeriodDays,
  };
}
export function payableCents(invoice: {
  totalCents: number;
  status: InvoiceStatus;
  payments: Array<{ amountCents: number; status: PaymentStatus }>;
}): number {
  if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) return 0;
  return Math.max(
    0,
    invoice.totalCents -
      invoice.payments
        .filter((p) =>
          [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED].some(
            (status) => status === p.status,
          ),
        )
        .reduce((sum, p) => sum + p.amountCents, 0),
  );
}
export function hasIssuedFinalWarning(invoice: CollectionDeadlineInvoice): boolean {
  return Boolean(invoice.finalWarningSentAt || invoice.recoveryFinalWarningSentAt);
}
/** One clock: explicit later extensions, one persisted recovery window, or the original grace deadline.
 * Legacy dates are retained only when a final warning actually announced them. Earlier speculative
 * reminder dates must not silently postpone grace expiry. Reading this helper never extends a deadline.
 */
export function suspensionDate(
  invoice: CollectionDeadlineInvoice,
  extension: Date | null,
  policy: CollectionSettings,
  dayMs: number,
): Date {
  const original =
    invoice.originalSuspensionDeadline ??
    new Date(invoice.dueDate.getTime() + policy.suspensionDays * dayMs);
  return new Date(
    Math.max(
      original.getTime(),
      extension?.getTime() ?? 0,
      invoice.recoverySuspensionDeadline?.getTime() ?? 0,
      hasIssuedFinalWarning(invoice) ? (invoice.suspensionScheduledAt?.getTime() ?? 0) : 0,
    ),
  );
}
export function finalWarningDueAt(deadline: Date, policy: CollectionSettings, dayMs: number): Date {
  return new Date(deadline.getTime() - (policy.suspensionDays - policy.finalWarningDays) * dayMs);
}
export function finalWarningAllowsSuspension(
  invoice: CollectionDeadlineInvoice,
  deadline: Date,
  now: Date,
): boolean {
  const issuedAt = invoice.recoveryFinalWarningSentAt ?? invoice.finalWarningSentAt;
  return Boolean(issuedAt && issuedAt < deadline && issuedAt <= now && deadline <= now);
}
export function nextWarning(
  invoice: CollectionDeadlineInvoice,
  now: Date,
  policy: CollectionSettings,
  dayMs: number,
  extension: Date | null = null,
): CollectionWarning | null {
  if (hasIssuedFinalWarning(invoice)) return null;
  const deadline = suspensionDate(invoice, extension, policy, dayMs);
  // A recovery window is immutable. Delivery failure cannot grant another automatic extension.
  if (invoice.recoverySuspensionDeadline) return now < deadline ? 'RECOVERY_FINAL_WARNING' : null;
  if (deadline <= now) return 'RECOVERY_FINAL_WARNING';
  // Catch up with one highest applicable warning, with at least one policy day between notices.
  const lastNotice = Math.max(
    invoice.firstReminderSentAt?.getTime() ?? 0,
    invoice.secondReminderSentAt?.getTime() ?? 0,
  );
  if (lastNotice && now.getTime() < lastNotice + dayMs) return null;
  if (now >= finalWarningDueAt(deadline, policy, dayMs)) return 'FINAL_WARNING';
  if (
    !invoice.secondReminderSentAt &&
    now.getTime() >= invoice.dueDate.getTime() + policy.secondReminderDays * dayMs
  )
    return 'SECOND_REMINDER';
  if (
    !invoice.firstReminderSentAt &&
    !invoice.secondReminderSentAt &&
    now.getTime() >= invoice.dueDate.getTime() + policy.firstReminderDays * dayMs
  )
    return 'FIRST_REMINDER';
  return null;
}

/** A recovery notice promises continued service, so its safety window covers the whole subscription. */
export function collectionExtension(
  extension: Date | null,
  invoices: Array<
    { recoverySuspensionDeadline?: Date | null } & {
      totalCents: number;
      status: InvoiceStatus;
      payments: Array<{ amountCents: number; status: PaymentStatus }>;
    }
  >,
): Date | null {
  const dates = invoices
    .filter((i) => payableCents(i) > 0)
    .flatMap((i) => (i.recoverySuspensionDeadline ? [i.recoverySuspensionDeadline.getTime()] : []));
  if (extension) dates.push(extension.getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}
