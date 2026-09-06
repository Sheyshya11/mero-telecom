import { ConflictException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, RefundStatus, Role } from '@prisma/client';

import { RefundPolicyService } from './refund-policy.service';

describe('RefundPolicyService', () => {
  const policy = new RefundPolicyService();
  const payment = {
    provider: PaymentProvider.STRIPE,
    providerPaymentId: 'pi_test',
    status: PaymentStatus.SUCCEEDED,
    amountCents: 10_000,
    refundedCents: 0,
  };

  it.each([PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.REFUNDED])(
    'rejects a %s payment',
    (status) => {
      expect(() => policy.assertCustomerRequestEligible({ ...payment, status })).toThrow(
        ConflictException,
      );
    },
  );

  it('accepts a paid or partially refunded Stripe payment with remaining value', () => {
    expect(() => policy.assertCustomerRequestEligible(payment)).not.toThrow();
    expect(() =>
      policy.assertCustomerRequestEligible({
        ...payment,
        status: PaymentStatus.PARTIALLY_REFUNDED,
        refundedCents: 2_000,
      }),
    ).not.toThrow();
  });

  it('rejects manual, zero-value, fully-refunded, and unlinked payments', () => {
    const invalid = [
      { ...payment, provider: PaymentProvider.MANUAL },
      { ...payment, amountCents: 0 },
      { ...payment, refundedCents: payment.amountCents },
      { ...payment, providerPaymentId: null },
    ];
    for (const candidate of invalid) {
      expect(() => policy.assertCustomerRequestEligible(candidate)).toThrow(ConflictException);
    }
  });

  it.each([
    [RefundStatus.REQUESTED, RefundStatus.UNDER_REVIEW],
    [RefundStatus.REQUESTED, RefundStatus.APPROVED],
    [RefundStatus.UNDER_REVIEW, RefundStatus.APPROVED],
    [RefundStatus.UNDER_REVIEW, RefundStatus.REJECTED],
    [RefundStatus.APPROVED, RefundStatus.PROCESSING],
    [RefundStatus.PROCESSING, RefundStatus.SUCCEEDED],
    [RefundStatus.PROCESSING, RefundStatus.FAILED],
    [RefundStatus.FAILED, RefundStatus.PROCESSING],
  ])('allows %s → %s', (from, to) => {
    expect(() => policy.assertTransition(from, to)).not.toThrow();
  });

  it.each([
    [RefundStatus.SUCCEEDED, RefundStatus.REQUESTED],
    [RefundStatus.REJECTED, RefundStatus.SUCCEEDED],
    [RefundStatus.PROCESSING, RefundStatus.APPROVED],
    [RefundStatus.CANCELLED, RefundStatus.PROCESSING],
  ])('rejects %s → %s', (from, to) => {
    expect(() => policy.assertTransition(from, to)).toThrow(ConflictException);
  });

  it('limits approval and processing to administrators', () => {
    expect(() => policy.assertCanApprove(Role.STAFF)).toThrow(ConflictException);
    expect(() => policy.assertCanProcess(Role.CUSTOMER)).toThrow(ConflictException);
    expect(() => policy.assertCanApprove(Role.ADMIN)).not.toThrow();
    expect(() => policy.assertCanProcess(Role.SUPER_ADMIN)).not.toThrow();
  });

  it('allows only a super administrator to record an override', () => {
    expect(() => policy.assertCanApprove(Role.ADMIN, 'Exceptional outage')).toThrow(
      ConflictException,
    );
    expect(() => policy.assertCanApprove(Role.SUPER_ADMIN, 'Exceptional outage')).not.toThrow();
  });
});
