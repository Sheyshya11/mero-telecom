import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { nextWarning, payableCents, suspensionDate } from './collection.service';
import { validateCollectionPolicy } from './collection-policy.service';
const policy = {
  firstReminderDays: 1,
  secondReminderDays: 3,
  finalWarningDays: 5,
  suspensionDays: 7,
};
const dayMs = 86_400_000;
const dueDate = new Date('2026-10-01T00:00:00Z');
const day = (n: number) => new Date(dueDate.getTime() + n * dayMs);
describe('Collection policy and warning timing', () => {
  it('implements days 1 / 3 / 5 and keeps day 0 quiet', () => {
    const invoice: {
      dueDate: Date;
      firstReminderSentAt: Date | null;
      secondReminderSentAt: Date | null;
      finalWarningSentAt: Date | null;
    } = {
      dueDate,
      firstReminderSentAt: null,
      secondReminderSentAt: null,
      finalWarningSentAt: null,
    };
    expect(nextWarning(invoice, day(0), policy, dayMs)).toBeNull();
    expect(nextWarning(invoice, day(1), policy, dayMs)).toBe('FIRST_REMINDER');
    invoice.firstReminderSentAt = day(1);
    expect(nextWarning(invoice, day(2), policy, dayMs)).toBeNull();
    expect(nextWarning(invoice, day(3), policy, dayMs)).toBe('SECOND_REMINDER');
    invoice.secondReminderSentAt = day(3);
    expect(nextWarning(invoice, day(4), policy, dayMs)).toBeNull();
    expect(nextWarning(invoice, day(5), policy, dayMs)).toBe('FINAL_WARNING');
    invoice.finalWarningSentAt = day(5);
    expect(nextWarning(invoice, day(6), policy, dayMs)).toBeNull();
    expect(
      suspensionDate({ ...invoice, suspensionScheduledAt: null }, null, policy, dayMs),
    ).toEqual(day(7));
  });
  it('skips missed earlier notices and recovers directly after expiry', () => {
    const invoice = { dueDate };
    expect(nextWarning(invoice, day(4), policy, dayMs)).toBe('SECOND_REMINDER');
    expect(nextWarning(invoice, day(5), policy, dayMs)).toBe('FINAL_WARNING');
    expect(nextWarning(invoice, day(10), policy, dayMs)).toBe('RECOVERY_FINAL_WARNING');
    expect(suspensionDate(invoice, null, policy, dayMs)).toEqual(day(7));
  });
  it('uses a persisted recovery deadline and a later explicit extension without sliding', () => {
    const invoice = { dueDate, recoverySuspensionDeadline: day(12) };
    expect(suspensionDate(invoice, null, policy, dayMs)).toEqual(day(12));
    expect(nextWarning(invoice, day(11), policy, dayMs)).toBe('RECOVERY_FINAL_WARNING');
    expect(nextWarning(invoice, day(13), policy, dayMs)).toBeNull();
    expect(suspensionDate(invoice, day(10), policy, dayMs)).toEqual(day(12));
    expect(suspensionDate(invoice, day(15), policy, dayMs)).toEqual(day(15));
  });
  it('moves an unissued final warning relative to an explicit extension', () => {
    expect(
      nextWarning(
        { dueDate, firstReminderSentAt: day(1), secondReminderSentAt: day(3) },
        day(5),
        policy,
        dayMs,
        day(10),
      ),
    ).toBeNull();
    expect(
      nextWarning({ dueDate, secondReminderSentAt: day(3) }, day(8), policy, dayMs, day(10)),
    ).toBe('FINAL_WARNING');
  });
  it('honors extensions and never shortens a previously announced suspension date', () => {
    expect(
      suspensionDate(
        { dueDate, finalWarningSentAt: day(5), suspensionScheduledAt: day(12) },
        day(10),
        policy,
        dayMs,
      ),
    ).toEqual(day(12));
  });
  it.each([
    [0, 3, 5, 7],
    [1, 1, 5, 7],
    [1, 3, 3, 7],
    [1, 3, 5, 5],
    [1.5, 3, 5, 7],
  ])('rejects invalid policy %p', (a, b, c, d) => {
    expect(() =>
      validateCollectionPolicy({
        firstReminderDays: a,
        secondReminderDays: b,
        finalWarningDays: c,
        suspensionDays: d,
      }),
    ).toThrow();
  });
  it('uses allocated credits and actual confirmed payments for partial balances', () => {
    expect(
      payableCents({
        totalCents: 4990,
        status: InvoiceStatus.OVERDUE,
        payments: [
          { amountCents: 2000, status: PaymentStatus.SUCCEEDED },
          { amountCents: 2990, status: PaymentStatus.PROCESSING },
        ],
      }),
    ).toBe(2990);
    expect(payableCents({ totalCents: 0, status: InvoiceStatus.OVERDUE, payments: [] })).toBe(0);
    expect(
      payableCents({
        totalCents: 7990,
        status: InvoiceStatus.PAID,
        payments: [{ amountCents: 7990, status: PaymentStatus.REFUNDED }],
      }),
    ).toBe(0);
  });
});
