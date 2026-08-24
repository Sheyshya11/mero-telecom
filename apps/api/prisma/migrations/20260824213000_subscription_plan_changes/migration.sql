CREATE TYPE "PlanChangeType" AS ENUM ('UPGRADE', 'DOWNGRADE');
CREATE TYPE "PlanChangeStatus" AS ENUM (
  'PENDING',
  'CHECKOUT_CREATED',
  'PROCESSING',
  'SCHEDULED',
  'APPLIED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
);

ALTER TABLE "Subscription"
ADD COLUMN "endReason" VARCHAR(100),
ADD COLUMN "billingAnchorDay" INTEGER,
ADD COLUMN "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);

-- Existing subscriptions were monthly and date-based. Preserve their original
-- anniversary day as the anchor. Historical/non-active rows retain their first
-- period; active rows are advanced to the monthly period containing migration
-- time so they can safely change plans immediately after deployment.
UPDATE "Subscription"
SET
  "billingAnchorDay" = EXTRACT(DAY FROM "startDate")::INTEGER,
  "currentPeriodStart" = "startDate"::TIMESTAMP,
  "currentPeriodEnd" = ("startDate" + INTERVAL '1 month')::TIMESTAMP;

WITH month_anchors AS (
  SELECT
    subscription."id",
    EXTRACT(DAY FROM subscription."startDate")::INTEGER AS anchor_day,
    date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '1 month' AS previous_month,
    date_trunc('month', CURRENT_TIMESTAMP) AS current_month,
    date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month' AS next_month
  FROM "Subscription" AS subscription
  WHERE subscription."status" = 'ACTIVE'
), boundaries AS (
  SELECT
    "id",
    previous_month + (
      LEAST(
        anchor_day,
        EXTRACT(DAY FROM (previous_month + INTERVAL '1 month - 1 day'))::INTEGER
      ) - 1
    ) * INTERVAL '1 day' AS previous_boundary,
    current_month + (
      LEAST(
        anchor_day,
        EXTRACT(DAY FROM (current_month + INTERVAL '1 month - 1 day'))::INTEGER
      ) - 1
    ) * INTERVAL '1 day' AS current_boundary,
    next_month + (
      LEAST(
        anchor_day,
        EXTRACT(DAY FROM (next_month + INTERVAL '1 month - 1 day'))::INTEGER
      ) - 1
    ) * INTERVAL '1 day' AS next_boundary
  FROM month_anchors
)
UPDATE "Subscription" AS subscription
SET
  "currentPeriodStart" = CASE
    WHEN boundaries.current_boundary <= CURRENT_TIMESTAMP THEN boundaries.current_boundary
    ELSE boundaries.previous_boundary
  END,
  "currentPeriodEnd" = CASE
    WHEN boundaries.current_boundary <= CURRENT_TIMESTAMP THEN boundaries.next_boundary
    ELSE boundaries.current_boundary
  END
FROM boundaries
WHERE subscription."id" = boundaries."id";

ALTER TABLE "Subscription"
ALTER COLUMN "billingAnchorDay" SET NOT NULL,
ALTER COLUMN "currentPeriodStart" SET NOT NULL,
ALTER COLUMN "currentPeriodEnd" SET NOT NULL;

ALTER TABLE "Subscription"
ADD CONSTRAINT "Subscription_billing_anchor_day_check"
CHECK ("billingAnchorDay" BETWEEN 1 AND 31),
ADD CONSTRAINT "Subscription_current_period_check"
CHECK ("currentPeriodEnd" > "currentPeriodStart");

CREATE TABLE "PlanChangeRequest" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "sourceSubscriptionId" UUID NOT NULL,
  "newSubscriptionId" UUID,
  "sourcePlanId" UUID NOT NULL,
  "targetPlanId" UUID NOT NULL,
  "type" "PlanChangeType" NOT NULL,
  "status" "PlanChangeStatus" NOT NULL DEFAULT 'PENDING',
  "currency" CHAR(3) NOT NULL DEFAULT 'AUD',
  "sourcePlanPriceCents" INTEGER NOT NULL,
  "targetPlanPriceCents" INTEGER NOT NULL,
  "unusedCreditCents" INTEGER NOT NULL,
  "proratedTargetCents" INTEGER NOT NULL,
  "amountPayableCents" INTEGER NOT NULL,
  "currentPeriodStartSnapshot" TIMESTAMP(3) NOT NULL,
  "currentPeriodEndSnapshot" TIMESTAMP(3) NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "stripeCheckoutSessionId" VARCHAR(255),
  "stripePaymentIntentId" VARCHAR(255),
  "invoiceId" UUID,
  "paymentId" UUID,
  "failureReason" VARCHAR(255),
  "cancellationReason" VARCHAR(255),
  "appliedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanChangeRequest_distinct_plans_check" CHECK ("sourcePlanId" <> "targetPlanId"),
  CONSTRAINT "PlanChangeRequest_amounts_check" CHECK (
    "sourcePlanPriceCents" > 0 AND
    "targetPlanPriceCents" > 0 AND
    "unusedCreditCents" >= 0 AND
    "proratedTargetCents" >= 0 AND
    "amountPayableCents" >= 0
  ),
  CONSTRAINT "PlanChangeRequest_period_check" CHECK (
    "currentPeriodEndSnapshot" > "currentPeriodStartSnapshot" AND
    "effectiveAt" <= "currentPeriodEndSnapshot"
  )
);

ALTER TABLE "PaymentWebhookEvent" ADD COLUMN "planChangeRequestId" UUID;

CREATE UNIQUE INDEX "PlanChangeRequest_newSubscriptionId_key"
ON "PlanChangeRequest"("newSubscriptionId");
CREATE UNIQUE INDEX "PlanChangeRequest_stripeCheckoutSessionId_key"
ON "PlanChangeRequest"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "PlanChangeRequest_stripePaymentIntentId_key"
ON "PlanChangeRequest"("stripePaymentIntentId");
CREATE UNIQUE INDEX "PlanChangeRequest_invoiceId_key"
ON "PlanChangeRequest"("invoiceId");
CREATE UNIQUE INDEX "PlanChangeRequest_paymentId_key"
ON "PlanChangeRequest"("paymentId");
CREATE INDEX "PlanChangeRequest_customerId_createdAt_idx"
ON "PlanChangeRequest"("customerId", "createdAt");
CREATE INDEX "PlanChangeRequest_sourceSubscriptionId_status_idx"
ON "PlanChangeRequest"("sourceSubscriptionId", "status");
CREATE INDEX "PlanChangeRequest_status_effectiveAt_idx"
ON "PlanChangeRequest"("status", "effectiveAt");
CREATE INDEX "PlanChangeRequest_type_status_idx"
ON "PlanChangeRequest"("type", "status");
CREATE INDEX "PaymentWebhookEvent_planChangeRequestId_idx"
ON "PaymentWebhookEvent"("planChangeRequestId");

-- The partial unique index is the database authority for one in-flight change.
-- It closes double-click and multi-instance races that an application-only
-- existence check cannot prevent.
CREATE UNIQUE INDEX "PlanChangeRequest_one_active_per_subscription"
ON "PlanChangeRequest"("sourceSubscriptionId")
WHERE "status" IN ('PENDING', 'CHECKOUT_CREATED', 'PROCESSING', 'SCHEDULED');

ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_sourceSubscriptionId_fkey"
FOREIGN KEY ("sourceSubscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_newSubscriptionId_fkey"
FOREIGN KEY ("newSubscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_sourcePlanId_fkey"
FOREIGN KEY ("sourcePlanId") REFERENCES "InternetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_targetPlanId_fkey"
FOREIGN KEY ("targetPlanId") REFERENCES "InternetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_planChangeRequestId_fkey"
FOREIGN KEY ("planChangeRequestId") REFERENCES "PlanChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
