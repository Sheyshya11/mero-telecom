import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma, RefundStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

type Transaction = Prisma.TransactionClient | PrismaService;

@Injectable()
export class RefundReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async totals(paymentId: string, transaction: Transaction = this.prisma) {
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: { amountCents: true },
    });
    if (!payment) return null;
    const [successful, reserved] = await Promise.all([
      transaction.refund.aggregate({
        where: { paymentId, status: RefundStatus.SUCCEEDED },
        _sum: { refundAmountCents: true },
      }),
      transaction.refund.aggregate({
        where: {
          paymentId,
          status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] },
        },
        _sum: { refundAmountCents: true },
      }),
    ]);
    const successfulCents = successful._sum.refundAmountCents ?? 0;
    const reservedCents = reserved._sum.refundAmountCents ?? 0;
    return {
      amountCents: payment.amountCents,
      successfulCents,
      reservedCents,
      remainingCents: Math.max(0, payment.amountCents - successfulCents - reservedCents),
    };
  }

  async reconcilePayment(paymentId: string, transaction: Transaction = this.prisma) {
    const totals = await this.totals(paymentId, transaction);
    if (!totals) return null;
    const status =
      totals.successfulCents <= 0
        ? PaymentStatus.SUCCEEDED
        : totals.successfulCents >= totals.amountCents
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;
    return transaction.payment.update({
      where: { id: paymentId },
      data: { refundedCents: Math.min(totals.successfulCents, totals.amountCents), status },
    });
  }
}
