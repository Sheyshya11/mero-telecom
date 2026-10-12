import { CollectionStage, InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { collectionHoldState, hasActiveCollectionHold } from './collection-hold.policy';
const now = new Date('2026-10-07T00:00:00Z');
const invoice = {
  id: 'invoice',
  status: InvoiceStatus.OVERDUE,
  collectionStage: CollectionStage.FIRST_REMINDER,
  dueDate: new Date('2026-10-01'),
  totalCents: 7990,
  payments: [],
};
describe('Collection hold eligibility', () => {
  it.each([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.SUSPENDED,
    SubscriptionStatus.CANCELLED,
    SubscriptionStatus.TERMINATED,
  ])('allows unresolved collectible debt on %s without changing service state', (status) => {
    const sub = { status };
    expect(collectionHoldState(sub, [invoice], now)).toMatchObject({
      canPlace: true,
      status: 'ACTIVE',
      collectibleCents: 7990,
    });
    expect(sub.status).toBe(status);
  });
  it.each([
    CollectionStage.NONE,
    CollectionStage.FIRST_REMINDER,
    CollectionStage.FINAL_WARNING,
    CollectionStage.SUSPENDED,
  ])('recognizes an unresolved overdue case at %s', (collectionStage) =>
    expect(
      collectionHoldState(
        { status: SubscriptionStatus.ACTIVE },
        [{ ...invoice, collectionStage }],
        now,
      ).canPlace,
    ).toBe(true),
  );
  it.each([SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED])(
    'rejects no debt or settled debt on %s',
    (status) => {
      expect(collectionHoldState({ status }, [], now).canPlace).toBe(false);
      expect(
        collectionHoldState({ status }, [{ ...invoice, status: InvoiceStatus.PAID }], now).canPlace,
      ).toBe(false);
      expect(collectionHoldState({ status }, [{ ...invoice, totalCents: 0 }], now)).toMatchObject({
        canPlace: false,
        status: 'RESOLVED',
      });
    },
  );
  it('reports pending overdue data and forbids pending holds', () => {
    expect(
      collectionHoldState({ status: SubscriptionStatus.PENDING }, [invoice], now),
    ).toMatchObject({ canPlace: false, inconsistent: true, status: 'NONE' });
    expect(collectionHoldState({ status: SubscriptionStatus.PENDING }, [], now).canPlace).toBe(
      false,
    );
  });
  it('does not reopen a resolved case even when old invoice amounts remain', () =>
    expect(
      collectionHoldState(
        { status: SubscriptionStatus.ACTIVE },
        [{ ...invoice, collectionStage: CollectionStage.RESOLVED }],
        now,
      ).canPlace,
    ).toBe(false));
  it('uses confirmed partial payments and credit previews rather than the original amount', () => {
    const sub = { status: SubscriptionStatus.ACTIVE };
    expect(
      collectionHoldState(
        sub,
        [{ ...invoice, payments: [{ status: PaymentStatus.SUCCEEDED, amountCents: 2000 }] }],
        now,
      ).collectibleCents,
    ).toBe(5990);
    expect(collectionHoldState(sub, [invoice], now, new Map([['invoice', 0]]))).toMatchObject({
      canPlace: false,
      status: 'RESOLVED',
    });
    expect(collectionHoldState(sub, [invoice], now, new Map([['invoice', 5990]]))).toMatchObject({
      canPlace: true,
      collectibleCents: 5990,
    });
  });
  it('allows updates, not duplicate placement, and expires exactly at the deadline', () => {
    const sub = {
      status: SubscriptionStatus.ACTIVE,
      collectionHoldReason: 'Billing dispute',
      collectionHoldUntil: new Date(now.getTime() + 1000),
    };
    expect(collectionHoldState(sub, [invoice], now)).toMatchObject({
      canPlace: false,
      canUpdate: true,
      active: true,
      status: 'ON_HOLD',
    });
    expect(collectionHoldState(sub, [invoice], sub.collectionHoldUntil)).toMatchObject({
      canPlace: true,
      active: false,
      status: 'ACTIVE',
    });
    expect(hasActiveCollectionHold({ ...sub, collectionHoldUntil: null }, now)).toBe(true);
  });
});
