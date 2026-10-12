import { CollectionStage, InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { payableCents } from './collection-deadline';
export interface HoldSubscription {
  status: SubscriptionStatus;
  collectionHoldReason?: string | null;
  collectionHoldUntil?: Date | null;
}
export interface HoldInvoice {
  id: string;
  status: InvoiceStatus;
  collectionStage: CollectionStage;
  dueDate: Date;
  totalCents: number;
  payments: Array<{ amountCents: number; status: PaymentStatus }>;
}
export function hasActiveCollectionHold(
  sub: HoldSubscription | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(
    sub?.collectionHoldReason?.trim() &&
    (!sub.collectionHoldUntil || sub.collectionHoldUntil > now),
  );
}
export function collectionHoldState(
  sub: HoldSubscription,
  invoices: HoldInvoice[],
  now = new Date(),
  balances?: Map<string, number>,
  previouslyResolved = false,
) {
  const debt = invoices.filter(
    (i) =>
      i.status === InvoiceStatus.OVERDUE &&
      i.dueDate < now &&
      i.collectionStage !== CollectionStage.RESOLVED,
  );
  const collectibleCents = debt.reduce(
    (sum, i) => sum + (balances?.get(i.id) ?? payableCents(i)),
    0,
  );
  const inconsistent = sub.status === SubscriptionStatus.PENDING && collectibleCents > 0;
  const actionable = collectibleCents > 0 && sub.status !== SubscriptionStatus.PENDING;
  const active = actionable && hasActiveCollectionHold(sub, now);
  const resolved =
    !actionable &&
    !inconsistent &&
    (previouslyResolved ||
      debt.length > 0 ||
      invoices.some((i) => i.collectionStage === CollectionStage.RESOLVED));
  return {
    status: active ? 'ON_HOLD' : actionable ? 'ACTIVE' : resolved ? 'RESOLVED' : 'NONE',
    canPlace: actionable && !active,
    canUpdate: active,
    canRelease: hasActiveCollectionHold(sub, now),
    active,
    collectibleCents,
    inconsistent,
    message:
      sub.status === SubscriptionStatus.PENDING
        ? inconsistent
          ? 'Collection hold is unavailable. An overdue invoice on a pending service requires billing review.'
          : 'Collection hold is unavailable because there is no active overdue collection case.'
        : resolved
          ? 'Collection resolved. No collection action is required.'
          : !actionable
            ? 'Collection hold is only available when the account has an unresolved overdue balance.'
            : active
              ? 'Automated reminders and billing suspension are paused.'
              : 'An unresolved overdue balance can be placed on collection hold.',
  };
}
