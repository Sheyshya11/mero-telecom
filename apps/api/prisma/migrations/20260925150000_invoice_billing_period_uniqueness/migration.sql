-- Standard subscription invoices use a canonical calendar-month period.
-- Nullable fields keep plan-change and other non-standard invoices outside this key.
ALTER TABLE "Invoice"
ADD COLUMN "billingPeriodStart" DATE,
ADD COLUMN "billingPeriodEnd" DATE;

-- Backfill only unambiguous legacy standard invoices. Historical duplicate months
-- are retained unchanged for audit purposes and are still found by application-level
-- legacy lookup. Plan-change invoices are adjustments, not monthly standard invoices.
WITH "CandidatePeriods" AS (
  SELECT
    invoice."id",
    invoice."subscriptionId",
    DATE_TRUNC('month', invoice."issueDate")::date AS "periodStart",
    (DATE_TRUNC('month', invoice."issueDate") + INTERVAL '1 month - 1 day')::date AS "periodEnd",
    COUNT(*) OVER (
      PARTITION BY invoice."subscriptionId", DATE_TRUNC('month', invoice."issueDate")
    ) AS "periodCount"
  FROM "Invoice" invoice
  WHERE invoice."subscriptionId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "PlanChangeRequest" plan_change
      WHERE plan_change."invoiceId" = invoice."id"
    )
)
UPDATE "Invoice" invoice
SET
  "billingPeriodStart" = candidate."periodStart",
  "billingPeriodEnd" = candidate."periodEnd"
FROM "CandidatePeriods" candidate
WHERE invoice."id" = candidate."id"
  AND candidate."periodCount" = 1;

DROP INDEX "Invoice_subscriptionId_issueDate_key";

CREATE UNIQUE INDEX "Invoice_subscriptionId_billingPeriodStart_billingPeriodEnd_key"
ON "Invoice"("subscriptionId", "billingPeriodStart", "billingPeriodEnd");
