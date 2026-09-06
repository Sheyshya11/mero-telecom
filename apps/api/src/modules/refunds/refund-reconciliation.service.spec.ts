import { PaymentStatus, RefundStatus } from '@prisma/client';

import { RefundReconciliationService } from './refund-reconciliation.service';

describe('RefundReconciliationService', () => {
  function setup(successfulCents: number, reservedCents = 0) {
    const payment = {
      findUnique: jest.fn().mockResolvedValue({ amountCents: 10_000 }),
      update: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };
    const refund = {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { refundAmountCents: successfulCents } })
        .mockResolvedValueOnce({ _sum: { refundAmountCents: reservedCents } }),
    };
    const prisma = { payment, refund };
    return {
      service: new RefundReconciliationService(prisma as never),
      prisma,
    };
  }

  it('calculates remaining value after successful and reserved refunds', async () => {
    const { service, prisma } = setup(2_000, 3_000);
    await expect(service.totals('payment-1')).resolves.toEqual({
      amountCents: 10_000,
      successfulCents: 2_000,
      reservedCents: 3_000,
      remainingCents: 5_000,
    });
    expect(prisma.refund.aggregate).toHaveBeenNthCalledWith(2, {
      where: {
        paymentId: 'payment-1',
        status: { in: [RefundStatus.APPROVED, RefundStatus.PROCESSING] },
      },
      _sum: { refundAmountCents: true },
    });
  });

  it.each([
    [0, PaymentStatus.SUCCEEDED],
    [3_000, PaymentStatus.PARTIALLY_REFUNDED],
    [10_000, PaymentStatus.REFUNDED],
  ])('reconciles %s completed cents to %s', async (successfulCents, status) => {
    const { service, prisma } = setup(successfulCents);
    await service.reconcilePayment('payment-1');
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { refundedCents: successfulCents, status },
    });
  });

  it('caps defensive reconciliation at the paid amount', async () => {
    const { service, prisma } = setup(12_000);
    await service.reconcilePayment('payment-1');
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { refundedCents: 10_000, status: PaymentStatus.REFUNDED },
    });
  });
});
