import { ConflictException, Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, RefundStatus, Role } from '@prisma/client';

@Injectable()
export class RefundPolicyService {
  assertCustomerRequestEligible(payment: {
    provider: PaymentProvider;
    providerPaymentId: string | null;
    status: PaymentStatus;
    amountCents: number;
    refundedCents: number;
  }): void {
    if (payment.refundedCents >= payment.amountCents || payment.status === PaymentStatus.REFUNDED) {
      this.conflict(
        'REFUND_ALREADY_FULLY_REFUNDED',
        'This payment has already been fully refunded.',
      );
    }
    if (
      payment.provider !== PaymentProvider.STRIPE ||
      !payment.providerPaymentId ||
      (payment.status !== PaymentStatus.SUCCEEDED &&
        payment.status !== PaymentStatus.PARTIALLY_REFUNDED)
    ) {
      this.conflict('REFUND_PAYMENT_NOT_PAID', 'Only a completed Stripe payment can be refunded.');
    }
    if (payment.amountCents <= 0) {
      this.conflict('REFUND_PAYMENT_NOT_PAID', 'This payment has no refundable value.');
    }
  }

  assertCanApprove(role: Role, overrideReason?: string): void {
    if (role !== Role.ADMIN && role !== Role.SUPER_ADMIN) {
      this.conflict('REFUND_PERMISSION_DENIED', 'Administrator approval is required.');
    }
    if (overrideReason && role !== Role.SUPER_ADMIN) {
      this.conflict(
        'REFUND_PERMISSION_DENIED',
        'Only a super administrator can apply a policy override.',
      );
    }
  }

  assertCanProcess(role: Role): void {
    if (role !== Role.ADMIN && role !== Role.SUPER_ADMIN) {
      this.conflict('REFUND_PERMISSION_DENIED', 'Administrator processing is required.');
    }
  }

  assertTransition(from: RefundStatus, to: RefundStatus): void {
    const allowed: Record<RefundStatus, readonly RefundStatus[]> = {
      DRAFT: [RefundStatus.REQUESTED, RefundStatus.CANCELLED],
      REQUESTED: [
        RefundStatus.UNDER_REVIEW,
        RefundStatus.APPROVED,
        RefundStatus.CANCELLED,
        RefundStatus.MORE_INFORMATION_REQUIRED,
      ],
      UNDER_REVIEW: [
        RefundStatus.APPROVED,
        RefundStatus.REJECTED,
        RefundStatus.CANCELLED,
        RefundStatus.MORE_INFORMATION_REQUIRED,
      ],
      MORE_INFORMATION_REQUIRED: [RefundStatus.UNDER_REVIEW, RefundStatus.CANCELLED],
      APPROVED: [RefundStatus.PROCESSING, RefundStatus.CANCELLED],
      REJECTED: [],
      PROCESSING: [RefundStatus.SUCCEEDED, RefundStatus.FAILED],
      SUCCEEDED: [],
      FAILED: [RefundStatus.PROCESSING, RefundStatus.CANCELLED],
      CANCELLED: [],
    };
    if (!allowed[from].includes(to)) {
      this.conflict(
        'REFUND_INVALID_STATE_TRANSITION',
        `A ${from.toLowerCase()} refund cannot move to ${to.toLowerCase()}.`,
      );
    }
  }

  conflict(code: string, message: string): never {
    throw new ConflictException({ code, message });
  }
}
