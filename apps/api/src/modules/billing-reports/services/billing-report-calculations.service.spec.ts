import { BillingReportCalculationsService } from './billing-report-calculations.service';

describe('BillingReportCalculationsService', () => {
  const calculations = new BillingReportCalculationsService();

  it('keeps net cash separate from credits and net billed', () => {
    expect(calculations.netCashCollected(0, 5_530)).toBe(-5_530);
    expect(calculations.netBilled(9_900, 1_000)).toBe(8_900);
  });

  it('returns zero ARPU when there are no active paid services', () => {
    expect(calculations.arpu(12_000, 0)).toBe(0);
  });

  it('calculates finalised-attempt success rate and ignores pending by construction', () => {
    expect(calculations.successRate(8, 2)).toBe(80);
    expect(calculations.successRate(0, 0)).toBe(0);
  });

  it('allocates GST proportionally using integer arithmetic', () => {
    expect(calculations.proportionalGst(4_950, 900, 9_900)).toBe(450);
    expect(calculations.proportionalGst(1_209, 220, 2_417)).toBe(110);
    expect(calculations.gstFromInclusive(9_900)).toBe(900);
  });

  it('does not invent a percentage when the previous period is zero', () => {
    expect(calculations.money(100, 0)).toMatchObject({
      percentageChange: null,
      direction: 'not_comparable',
    });
  });
});
