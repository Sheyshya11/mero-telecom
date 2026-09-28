import { BillingService } from './billing.service';

describe('BillingService', () => {
  const service = new BillingService();

  it('calculates GST-inclusive amounts deterministically in cents', () => {
    expect(service.calculateGstInclusiveAmounts(6900)).toEqual({
      subtotalCents: 6273,
      taxCents: 627,
      totalCents: 6900,
    });
  });

  it('uses fourteen-day payment terms without local timezone drift', () => {
    expect(service.dueDateFor(new Date('2026-01-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('resolves a canonical calendar-month billing period', () => {
    expect(service.billingPeriodFor(new Date('2026-10-19T22:30:00.000Z'))).toEqual({
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: new Date('2026-10-31T00:00:00.000Z'),
    });
  });

  it.each([
    ['start', '2026-08-01T00:00:00.000Z', 6900, 9900, 6900, 9900, 3000],
    ['middle', '2026-08-16T12:00:00.000Z', 6900, 9900, 3450, 4950, 1500],
    ['near end', '2026-08-31T23:59:59.999Z', 6900, 9900, 0, 0, 0],
  ])(
    'prorates an upgrade at the %s of a period with integer round-half-up',
    (_label, calculatedAt, source, target, credit, targetCharge, payable) => {
      expect(
        service.calculatePlanChangeProration({
          sourcePriceCents: source,
          targetPriceCents: target,
          currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
          calculatedAt: new Date(calculatedAt),
        }),
      ).toEqual(
        expect.objectContaining({
          type: 'UPGRADE',
          unusedCreditCents: credit,
          proratedTargetCents: targetCharge,
          amountPayableCents: payable,
        }),
      );
    },
  );

  it('returns a boundary-scheduled zero-charge downgrade', () => {
    expect(
      service.calculatePlanChangeProration({
        sourcePriceCents: 9900,
        targetPriceCents: 6900,
        currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
        calculatedAt: new Date('2026-08-16T12:00:00.000Z'),
      }),
    ).toEqual(
      expect.objectContaining({
        type: 'DOWNGRADE',
        amountPayableCents: 0,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );
  });

  it.each([
    [
      '31-day month',
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-08-16T12:00:00.000Z',
      3450,
    ],
    [
      '30-day month',
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      '2026-09-16T00:00:00.000Z',
      3450,
    ],
    [
      'leap February',
      '2028-02-01T00:00:00.000Z',
      '2028-03-01T00:00:00.000Z',
      '2028-02-15T12:00:00.000Z',
      3450,
    ],
    [
      'period start',
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      6900,
    ],
    [
      'period end',
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      0,
    ],
  ])(
    'calculates an exact cancellation refund for a %s',
    (_label, currentPeriodStart, currentPeriodEnd, cancelledAt, refundCents) => {
      expect(
        service.calculateCancellationProration({
          paidAmountCents: 6900,
          currentPeriodStart: new Date(currentPeriodStart),
          currentPeriodEnd: new Date(currentPeriodEnd),
          cancelledAt: new Date(cancelledAt),
        }).refundCents,
      ).toBe(refundCents);
    },
  );

  it('keeps a 31st anchor across short months and leap years', () => {
    const february = service.nextMonthlyBoundary(new Date('2028-01-31T08:30:00.000Z'), 31);
    const march = service.nextMonthlyBoundary(february, 31);
    expect(february.toISOString()).toBe('2028-02-29T08:30:00.000Z');
    expect(march.toISOString()).toBe('2028-03-31T08:30:00.000Z');
  });
});
