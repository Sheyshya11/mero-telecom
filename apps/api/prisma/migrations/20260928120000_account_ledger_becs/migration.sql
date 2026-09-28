ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING' AFTER 'PENDING';

CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'AU_BECS_DEBIT');
CREATE TYPE "AccountTransactionType" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "AccountTransactionReason" AS ENUM (
  'BILLING_CORRECTION',
  'SERVICE_OUTAGE',
  'CANCELLATION_UNUSED_SERVICE',
  'RELOCATION_SERVICE_GAP',
  'OVERPAYMENT',
  'PLAN_CHANGE_ADJUSTMENT',
  'GOODWILL',
  'UNDERCHARGE_CORRECTION',
  'INSTALLATION_CHARGE',
  'EQUIPMENT_CHARGE',
  'OTHER',
  'REVERSAL'
);
CREATE TYPE "AccountTransactionStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'AVAILABLE',
  'PARTIALLY_USED',
  'USED',
  'REFUNDED',
  'VOIDED',
  'REVERSED'
);
CREATE TYPE "AccountCreditClassification" AS ENUM ('REFUNDABLE', 'SERVICE_ONLY');
CREATE TYPE "StripeSyncStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED');

ALTER TABLE "Subscription"
ADD COLUMN "paymentMethodType" "PaymentMethodType";

ALTER TABLE "Payment"
ADD COLUMN "paymentMethodType" "PaymentMethodType",
ADD COLUMN "paymentMethodBrand" VARCHAR(50),
ADD COLUMN "paymentMethodLast4" CHAR(4);

CREATE TABLE "AccountTransaction" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "subscriptionId" UUID,
  "invoiceId" UUID,
  "type" "AccountTransactionType" NOT NULL,
  "reason" "AccountTransactionReason" NOT NULL,
  "status" "AccountTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "creditClassification" "AccountCreditClassification",
  "suggestedAmountCents" INTEGER,
  "amountCents" INTEGER NOT NULL,
  "remainingAmountCents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'AUD',
  "description" VARCHAR(500) NOT NULL,
  "internalNote" VARCHAR(2000),
  "approvalNote" VARCHAR(2000),
  "calculation" JSONB,
  "sourceType" VARCHAR(80),
  "sourceId" VARCHAR(255),
  "deduplicationKey" VARCHAR(255),
  "stripeSyncStatus" "StripeSyncStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "stripeBalanceTransactionId" VARCHAR(255),
  "stripeSyncFailureReason" VARCHAR(500),
  "stripeSyncAttempts" INTEGER NOT NULL DEFAULT 0,
  "stripeLastSyncAttemptAt" TIMESTAMP(3),
  "stripeSyncedAt" TIMESTAMP(3),
  "createdByUserId" UUID,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "reversesTransactionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AccountTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountTransaction_positive_amount" CHECK ("amountCents" > 0),
  CONSTRAINT "AccountTransaction_positive_suggested_amount" CHECK (
    "suggestedAmountCents" IS NULL OR "suggestedAmountCents" > 0
  ),
  CONSTRAINT "AccountTransaction_valid_remaining" CHECK (
    "remainingAmountCents" >= 0 AND "remainingAmountCents" <= "amountCents"
  ),
  CONSTRAINT "AccountTransaction_credit_classification" CHECK (
    ("type" = 'CREDIT' AND "creditClassification" IS NOT NULL)
    OR ("type" = 'DEBIT' AND "creditClassification" IS NULL)
  )
);

CREATE TABLE "CreditApplication" (
  "id" UUID NOT NULL,
  "accountTransactionId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "stripeInvoiceId" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditApplication_positive_amount" CHECK ("amountCents" > 0)
);

CREATE UNIQUE INDEX "AccountTransaction_deduplicationKey_key"
ON "AccountTransaction"("deduplicationKey");
CREATE UNIQUE INDEX "AccountTransaction_stripeBalanceTransactionId_key"
ON "AccountTransaction"("stripeBalanceTransactionId");
CREATE UNIQUE INDEX "AccountTransaction_reversesTransactionId_key"
ON "AccountTransaction"("reversesTransactionId");
CREATE INDEX "AccountTransaction_customerId_createdAt_id_idx"
ON "AccountTransaction"("customerId", "createdAt", "id");
CREATE INDEX "AccountTransaction_customerId_status_type_createdAt_idx"
ON "AccountTransaction"("customerId", "status", "type", "createdAt");
CREATE INDEX "AccountTransaction_subscriptionId_createdAt_idx"
ON "AccountTransaction"("subscriptionId", "createdAt");
CREATE INDEX "AccountTransaction_invoiceId_idx"
ON "AccountTransaction"("invoiceId");
CREATE INDEX "AccountTransaction_stripeSyncStatus_updatedAt_idx"
ON "AccountTransaction"("stripeSyncStatus", "updatedAt");
CREATE INDEX "AccountTransaction_sourceType_sourceId_idx"
ON "AccountTransaction"("sourceType", "sourceId");

CREATE UNIQUE INDEX "CreditApplication_accountTransactionId_invoiceId_key"
ON "CreditApplication"("accountTransactionId", "invoiceId");
CREATE INDEX "CreditApplication_invoiceId_createdAt_idx"
ON "CreditApplication"("invoiceId", "createdAt");

ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountTransaction"
ADD CONSTRAINT "AccountTransaction_reversesTransactionId_fkey"
FOREIGN KEY ("reversesTransactionId") REFERENCES "AccountTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditApplication"
ADD CONSTRAINT "CreditApplication_accountTransactionId_fkey"
FOREIGN KEY ("accountTransactionId") REFERENCES "AccountTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditApplication"
ADD CONSTRAINT "CreditApplication_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
