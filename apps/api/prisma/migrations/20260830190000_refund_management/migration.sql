-- Extend the existing payment lifecycle without rewriting historical payments.
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED' BEFORE 'REFUNDED';

CREATE TYPE "RefundType" AS ENUM ('FULL', 'PARTIAL');
CREATE TYPE "RefundReason" AS ENUM (
  'DUPLICATE_PAYMENT',
  'SERVICE_UNAVAILABLE',
  'BILLING_ERROR',
  'CANCELLED_BEFORE_ACTIVATION',
  'SERVICE_ISSUE',
  'GOODWILL',
  'OTHER'
);
CREATE TYPE "RefundStatus" AS ENUM (
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

ALTER TABLE "Payment"
ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Refund" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID,
  "subscriptionId" UUID,
  "stripePaymentIntentId" VARCHAR(255) NOT NULL,
  "stripeChargeId" VARCHAR(255),
  "stripeRefundId" VARCHAR(255),
  "originalAmountCents" INTEGER NOT NULL,
  "refundAmountCents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "type" "RefundType" NOT NULL,
  "reason" "RefundReason" NOT NULL,
  "customerReason" VARCHAR(2000),
  "internalNote" VARCHAR(2000),
  "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedByUserId" UUID,
  "approvedByUserId" UUID,
  "processedByUserId" UUID,
  "rejectedByUserId" UUID,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" VARCHAR(500),
  "processingAttempt" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentWebhookEvent"
ADD COLUMN "refundId" UUID;

CREATE UNIQUE INDEX "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");
CREATE INDEX "Refund_customerId_createdAt_idx" ON "Refund"("customerId", "createdAt");
CREATE INDEX "Refund_paymentId_status_idx" ON "Refund"("paymentId", "status");
CREATE INDEX "Refund_invoiceId_idx" ON "Refund"("invoiceId");
CREATE INDEX "Refund_subscriptionId_idx" ON "Refund"("subscriptionId");
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");
CREATE INDEX "Refund_reason_createdAt_idx" ON "Refund"("reason", "createdAt");
CREATE INDEX "PaymentWebhookEvent_refundId_idx" ON "PaymentWebhookEvent"("refundId");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedByUserId_fkey"
FOREIGN KEY ("processedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_rejectedByUserId_fkey"
FOREIGN KEY ("rejectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Financial invariants: application checks produce friendly errors; database checks are the final guard.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_originalAmountCents_positive"
CHECK ("originalAmountCents" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refundAmountCents_positive"
CHECK ("refundAmountCents" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refund_not_above_original"
CHECK ("refundAmountCents" <= "originalAmountCents");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundedCents_nonnegative"
CHECK ("refundedCents" >= 0 AND "refundedCents" <= "amountCents");
