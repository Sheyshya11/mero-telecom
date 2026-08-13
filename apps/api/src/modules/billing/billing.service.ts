import { BadRequestException, Injectable } from '@nestjs/common';

export interface InvoiceAmounts {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
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
}
