-- This migration intentionally precedes the already-applied generated index cleanup at
-- 20260926064912. It makes that cleanup safe on a fresh database without changing the
-- checksum of an applied migration. The recurring-billing migration recreates the indexes.
CREATE INDEX IF NOT EXISTS "Subscription_billingMode_status_idx"
ON "Subscription"("status");

CREATE INDEX IF NOT EXISTS "Subscription_nextBillingAt_idx"
ON "Subscription"("currentPeriodEnd");

CREATE INDEX IF NOT EXISTS "Invoice_type_status_idx"
ON "Invoice"("status");
