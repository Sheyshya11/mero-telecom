CREATE TYPE "InvoiceCollectionStatus" AS ENUM (
  'NONE',
  'SCHEDULED',
  'RETRYING',
  'ACTION_REQUIRED',
  'PAYMENT_METHOD_REQUIRED',
  'EXHAUSTED'
);

CREATE TYPE "RecurringSetupAttemptStatus" AS ENUM (
  'PENDING',
  'CHECKOUT_CREATED',
  'PROCESSING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'FAILED'
);

ALTER TABLE "Invoice"
ADD COLUMN "collectionStatus" "InvoiceCollectionStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "stripeAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stripeNextPaymentAttempt" TIMESTAMP(3),
ADD COLUMN "stripeLastPaymentErrorCode" VARCHAR(100),
ADD COLUMN "paymentActionRequiredAt" TIMESTAMP(3);

CREATE TABLE "RecurringSetupAttempt" (
  "id" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "status" "RecurringSetupAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "expectedPlanId" UUID NOT NULL,
  "expectedStripePriceId" VARCHAR(255) NOT NULL,
  "expectedCurrentPeriodStart" TIMESTAMP(3) NOT NULL,
  "expectedCurrentPeriodEnd" TIMESTAMP(3) NOT NULL,
  "expectedSubscriptionUpdatedAt" TIMESTAMP(3) NOT NULL,
  "paymentMethodType" "PaymentMethodType" NOT NULL,
  "stripeCheckoutSessionId" VARCHAR(255),
  "stripeSetupIntentId" VARCHAR(255),
  "stripeSubscriptionId" VARCHAR(255),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "failureReason" VARCHAR(500),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecurringSetupAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurringSetupAttempt_stripeCheckoutSessionId_key"
ON "RecurringSetupAttempt"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "RecurringSetupAttempt_stripeSubscriptionId_key"
ON "RecurringSetupAttempt"("stripeSubscriptionId");
CREATE UNIQUE INDEX "RecurringSetupAttempt_one_open_per_subscription"
ON "RecurringSetupAttempt"("subscriptionId")
WHERE "status" IN ('PENDING', 'CHECKOUT_CREATED', 'PROCESSING');
CREATE INDEX "RecurringSetupAttempt_subscriptionId_status_expiresAt_idx"
ON "RecurringSetupAttempt"("subscriptionId", "status", "expiresAt");
CREATE INDEX "RecurringSetupAttempt_customerId_createdAt_idx"
ON "RecurringSetupAttempt"("customerId", "createdAt");

ALTER TABLE "RecurringSetupAttempt"
ADD CONSTRAINT "RecurringSetupAttempt_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringSetupAttempt"
ADD CONSTRAINT "RecurringSetupAttempt_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
