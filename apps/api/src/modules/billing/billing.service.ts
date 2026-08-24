import { BadRequestException, Injectable } from '@nestjs/common';

export interface InvoiceAmounts {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export type PlanChangeDirection = 'UPGRADE' | 'DOWNGRADE';

export interface PlanChangeProration {
  type: PlanChangeDirection;
  periodDurationMilliseconds: number;
  remainingDurationMilliseconds: number;
  unusedCreditCents: number;
  proratedTargetCents: number;
  amountPayableCents: number;
  effectiveAt: Date;
}

@Injectable()
export class BillingService {
  private static readonly gstDivisor = 11;
  private static readonly paymentTermsDays = 14;

  calculateGstInclusiveAmounts(totalCents: number): InvoiceAmounts {
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
      throw new BadRequestException('A billable plan must have a positive integer price in cents.');
    }

    const taxCents = Math.round(totalCents / BillingService.gstDivisor);
    return { subtotalCents: totalCents - taxCents, taxCents, totalCents };
  }

  dueDateFor(issueDate: Date): Date {
    const dueDate = new Date(issueDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + BillingService.paymentTermsDays);
    return dueDate;
  }

  billingPeriodLabel(issueDate: Date): string {
    return new Intl.DateTimeFormat('en-AU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(issueDate);
  }

  calculatePlanChangeProration(input: {
    sourcePriceCents: number;
    targetPriceCents: number;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    calculatedAt: Date;
  }): PlanChangeProration {
    this.assertPositiveCents(input.sourcePriceCents);
    this.assertPositiveCents(input.targetPriceCents);
    if (input.sourcePriceCents === input.targetPriceCents) {
      throw new BadRequestException('The selected plan has the same monthly price.');
    }

    const periodStart = input.currentPeriodStart.getTime();
    const periodEnd = input.currentPeriodEnd.getTime();
    const calculatedAt = input.calculatedAt.getTime();
    if (
      ![periodStart, periodEnd, calculatedAt].every(Number.isFinite) ||
      periodEnd <= periodStart
    ) {
      throw new BadRequestException('The subscription billing period is invalid.');
    }
    if (calculatedAt < periodStart || calculatedAt >= periodEnd) {
      throw new BadRequestException('The subscription is outside its current billing period.');
    }

    const periodDurationMilliseconds = periodEnd - periodStart;
    const remainingDurationMilliseconds = periodEnd - calculatedAt;
    const unusedCreditCents = this.proratedCents(
      input.sourcePriceCents,
      remainingDurationMilliseconds,
      periodDurationMilliseconds,
    );
    const proratedTargetCents = this.proratedCents(
      input.targetPriceCents,
      remainingDurationMilliseconds,
      periodDurationMilliseconds,
    );
    const type: PlanChangeDirection =
      input.targetPriceCents > input.sourcePriceCents ? 'UPGRADE' : 'DOWNGRADE';

    return {
      type,
      periodDurationMilliseconds,
      remainingDurationMilliseconds,
      unusedCreditCents,
      proratedTargetCents,
      amountPayableCents:
        type === 'UPGRADE' ? Math.max(0, proratedTargetCents - unusedCreditCents) : 0,
      effectiveAt: type === 'UPGRADE' ? input.calculatedAt : input.currentPeriodEnd,
    };
  }

  nextMonthlyBoundary(periodStart: Date, billingAnchorDay: number): Date {
    if (!Number.isInteger(billingAnchorDay) || billingAnchorDay < 1 || billingAnchorDay > 31) {
      throw new BadRequestException('The subscription billing anchor day is invalid.');
    }
    if (!Number.isFinite(periodStart.getTime())) {
      throw new BadRequestException('The subscription billing period start is invalid.');
    }
    const targetMonth = new Date(
      Date.UTC(
        periodStart.getUTCFullYear(),
        periodStart.getUTCMonth() + 1,
        1,
        periodStart.getUTCHours(),
        periodStart.getUTCMinutes(),
        periodStart.getUTCSeconds(),
        periodStart.getUTCMilliseconds(),
      ),
    );
    const lastDay = new Date(
      Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
    ).getUTCDate();
    targetMonth.setUTCDate(Math.min(billingAnchorDay, lastDay));
    return targetMonth;
  }

  private proratedCents(
    monthlyCents: number,
    remainingMilliseconds: number,
    periodMilliseconds: number,
  ): number {
    // Integer round-half-up: floor((2 * price * remaining + period) / (2 * period)).
    // BigInt prevents precision loss for the price × millisecond multiplication.
    const numerator = 2n * BigInt(monthlyCents) * BigInt(remainingMilliseconds);
    const denominator = 2n * BigInt(periodMilliseconds);
    return Number((numerator + BigInt(periodMilliseconds)) / denominator);
  }

  private assertPositiveCents(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException('Plan prices must be positive integer cents.');
    }
  }
}
