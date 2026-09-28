CREATE TYPE "BillingMode" AS ENUM ('MANUAL', 'STRIPE_RECURRING');
CREATE TYPE "InvoiceType" AS ENUM ('MANUAL', 'STRIPE_RECURRING', 'PLAN_PURCHASE', 'PLAN_CHANGE');

ALTER TABLE "InternetPlan"
ADD COLUMN "stripePriceId" VARCHAR(255);

ALTER TABLE "Subscription"
ADD COLUMN "billingMode" "BillingMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "stripeSubscriptionId" VARCHAR(255),
ADD COLUMN "stripePriceId" VARCHAR(255),
ADD COLUMN "stripeStatus" VARCHAR(50),
ADD COLUMN "stripePaymentMethodId" VARCHAR(255),
ADD COLUMN "paymentMethodBrand" VARCHAR(50),
ADD COLUMN "paymentMethodLast4" CHAR(4),
ADD COLUMN "paymentMethodExpMonth" INTEGER,
ADD COLUMN "paymentMethodExpYear" INTEGER,
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "nextBillingAt" TIMESTAMP(3);

ALTER TABLE "Invoice"
ADD COLUMN "type" "InvoiceType" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "stripeInvoiceId" VARCHAR(255),
ADD COLUMN "stripeHostedUrl" VARCHAR(2048),
ADD COLUMN "stripePdfUrl" VARCHAR(2048);

ALTER TABLE "CheckoutApplication"
ADD COLUMN "stripeSubscriptionId" VARCHAR(255);

CREATE UNIQUE INDEX "InternetPlan_stripePriceId_key" ON "InternetPlan"("stripePriceId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");
CREATE UNIQUE INDEX "CheckoutApplication_stripeSubscriptionId_key" ON "CheckoutApplication"("stripeSubscriptionId");

CREATE INDEX "Subscription_billingMode_status_idx" ON "Subscription"("billingMode", "status");
CREATE INDEX "Subscription_nextBillingAt_idx" ON "Subscription"("nextBillingAt");
CREATE INDEX "Invoice_type_status_idx" ON "Invoice"("type", "status");

-- Preserve the meaning of historical one-time records. New webhook-mirrored
-- subscription invoices are explicitly written as STRIPE_RECURRING.
UPDATE "Invoice" SET "type" = 'PLAN_CHANGE'
WHERE EXISTS (
  SELECT 1 FROM "PlanChangeRequest" request WHERE request."invoiceId" = "Invoice"."id"
);

UPDATE "Invoice" SET "type" = 'PLAN_PURCHASE'
WHERE "purchasePlanId" IS NOT NULL AND "type" = 'MANUAL';
