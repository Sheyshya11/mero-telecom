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
});
