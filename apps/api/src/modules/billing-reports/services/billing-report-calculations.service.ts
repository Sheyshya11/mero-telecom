import { Injectable } from '@nestjs/common';

import type { CountMetric, MoneyMetric } from '../billing-report.types';

@Injectable()
export class BillingReportCalculationsService {
  money(valueCents: number, previousPeriodValueCents: number): MoneyMetric {
    return {
      valueCents,
      previousPeriodValueCents,
      percentageChange: this.percentageChange(valueCents, previousPeriodValueCents),
      direction: this.direction(valueCents, previousPeriodValueCents),
    };
  }

  count(count: number, previousPeriodCount: number): CountMetric {
    return {
      count,
      previousPeriodCount,
      percentageChange: this.percentageChange(count, previousPeriodCount),
      direction: this.direction(count, previousPeriodCount),
    };
  }

  netCashCollected(paymentsReceivedCents: number, refundsPaidCents: number): number {
    return paymentsReceivedCents - refundsPaidCents;
  }

  netBilled(grossBilledCents: number, creditsIssuedCents: number): number {
    return grossBilledCents - creditsIssuedCents;
  }

  arpu(mrrCents: number, activeServices: number): number {
    return activeServices === 0 ? 0 : Math.round(mrrCents / activeServices);
  }

  successRate(successfulAttempts: number, failedAttempts: number): number {
    const finalisedAttempts = successfulAttempts + failedAttempts;
    return finalisedAttempts === 0
      ? 0
      : Math.round((successfulAttempts / finalisedAttempts) * 10_000) / 100;
  }

  proportionalGst(amountCents: number, invoiceTaxCents: number, invoiceTotalCents: number): number {
    if (amountCents <= 0 || invoiceTaxCents <= 0 || invoiceTotalCents <= 0) return 0;
    const total = BigInt(invoiceTotalCents);
    return Number((BigInt(amountCents) * BigInt(invoiceTaxCents) + total / 2n) / total);
  }

  gstFromInclusive(amountCents: number): number {
    return Math.round(amountCents / 11);
  }

  private percentageChange(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
  }

  private direction(current: number, previous: number): MoneyMetric['direction'] {
    if (previous === 0 && current !== 0) return 'not_comparable';
    if (current > previous) return 'up';
    if (current < previous) return 'down';
    return 'flat';
  }
}
