import { Injectable } from '@nestjs/common';
import { RefundReason } from '@prisma/client';
import type Stripe from 'stripe';

import { StripeClientService } from '../payments/stripe-client.service';

@Injectable()
export class StripeRefundService {
  private readonly stripe: Stripe;

  constructor(stripeClient: StripeClientService) {
    this.stripe = stripeClient.client;
  }

  create(input: {
    refundId: string;
    paymentIntentId: string;
    amountCents: number;
    reason: RefundReason;
    customerId: string;
    paymentId: string;
    invoiceId?: string | null;
    processingAttempt: number;
  }): Promise<Stripe.Response<Stripe.Refund>> {
    return this.stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
        reason: this.stripeReason(input.reason),
        metadata: {
          meroRefundId: input.refundId,
          customerId: input.customerId,
          paymentId: input.paymentId,
          ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        },
      },
      { idempotencyKey: `mero-refund-${input.refundId}-${input.processingAttempt}` },
    );
  }

  retrieve(refundId: string): Promise<Stripe.Response<Stripe.Refund>> {
    return this.stripe.refunds.retrieve(refundId);
  }

  private stripeReason(reason: RefundReason): Stripe.RefundCreateParams.Reason {
    return reason === RefundReason.DUPLICATE_PAYMENT ? 'duplicate' : 'requested_by_customer';
  }
}
