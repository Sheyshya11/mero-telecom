import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PaymentEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async hasBlockingOutstandingBalance(
    subscriptionId: string,
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await database.invoice.count({
      where: {
        subscriptionId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE] },
        dueDate: { lte: new Date() },
      },
    });
    return count > 0;
  }
}
