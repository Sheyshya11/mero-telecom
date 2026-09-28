ALTER TYPE "RefundReason" ADD VALUE 'CANCELLATION_PRORATION';

ALTER TABLE "CancellationRequest"
  ADD COLUMN "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundCalculation" JSONB;

ALTER TABLE "Refund"
  ADD COLUMN "cancellationRequestId" UUID;

CREATE UNIQUE INDEX "Refund_cancellationRequestId_key"
  ON "Refund"("cancellationRequestId");

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_cancellationRequestId_fkey"
  FOREIGN KEY ("cancellationRequestId") REFERENCES "CancellationRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
