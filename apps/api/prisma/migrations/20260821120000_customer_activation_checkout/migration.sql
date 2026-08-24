CREATE TYPE "UserStatus" AS ENUM ('INVITATION_PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "AddressType" AS ENUM ('RESIDENTIAL', 'SERVICE', 'BILLING');
CREATE TYPE "AccountInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
CREATE TYPE "AccountInvitationReason" AS ENUM ('ONLINE_PURCHASE', 'ADMIN_CREATED', 'RESEND');
CREATE TYPE "CheckoutApplicationStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'REQUIRES_REVIEW');

ALTER TYPE "CustomerStatus" ADD VALUE 'INVITATION_PENDING';

ALTER TABLE "Customer" ADD COLUMN "stripeCustomerId" VARCHAR(255);

ALTER TABLE "InternetPlan"
ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "tierRank" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "passwordHash" DROP NOT NULL;

UPDATE "User"
SET "emailVerifiedAt" = "createdAt"
WHERE "isActive" = true;

UPDATE "User"
SET "status" = 'DEACTIVATED'
WHERE "isActive" = false;

WITH ranked_plans AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "monthlyCents", "name")::INTEGER AS rank
  FROM "InternetPlan"
)
UPDATE "InternetPlan" AS plan
SET "tierRank" = ranked_plans.rank
FROM ranked_plans
WHERE plan."id" = ranked_plans."id";

CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "AddressType" NOT NULL,
    "addressLine1" VARCHAR(255) NOT NULL,
    "addressLine2" VARCHAR(255),
    "suburb" VARCHAR(100) NOT NULL,
    "state" VARCHAR(3) NOT NULL,
    "postcode" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CustomerAddress" (
  "id", "customerId", "type", "addressLine1", "addressLine2", "suburb", "state", "postcode", "updatedAt"
)
SELECT gen_random_uuid(), customer."id", address_type."type", customer."addressLine1",
       customer."addressLine2", customer."suburb", customer."state", customer."postcode", CURRENT_TIMESTAMP
FROM "Customer" AS customer
CROSS JOIN (VALUES ('RESIDENTIAL'::"AddressType"), ('SERVICE'::"AddressType"), ('BILLING'::"AddressType")) AS address_type("type");

CREATE TABLE "CheckoutApplication" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "applicantEmail" VARCHAR(320) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "residentialAddress" JSONB NOT NULL,
    "serviceAddress" JSONB NOT NULL,
    "billingAddress" JSONB NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "privacyAcceptedAt" TIMESTAMP(3) NOT NULL,
    "status" "CheckoutApplicationStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "amountCents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'AUD',
    "stripeCheckoutSessionId" VARCHAR(255),
    "stripePaymentIntentId" VARCHAR(255),
    "stripeCustomerId" VARCHAR(255),
    "customerId" UUID,
    "invoiceId" UUID,
    "paymentId" UUID,
    "subscriptionId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CheckoutApplication_positive_amount" CHECK ("amountCents" > 0)
);

CREATE TABLE "AccountInvitation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "AccountInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" "AccountInvitationReason" NOT NULL,
    "createdByUserId" UUID,
    "checkoutApplicationId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountInvitation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAddress_postcode_idx" ON "CustomerAddress"("postcode");
CREATE UNIQUE INDEX "CustomerAddress_customerId_type_key" ON "CustomerAddress"("customerId", "type");
CREATE UNIQUE INDEX "CheckoutApplication_applicantEmail_key" ON "CheckoutApplication"("applicantEmail");
CREATE UNIQUE INDEX "CheckoutApplication_stripeCheckoutSessionId_key" ON "CheckoutApplication"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "CheckoutApplication_stripePaymentIntentId_key" ON "CheckoutApplication"("stripePaymentIntentId");
CREATE UNIQUE INDEX "CheckoutApplication_customerId_key" ON "CheckoutApplication"("customerId");
CREATE UNIQUE INDEX "CheckoutApplication_invoiceId_key" ON "CheckoutApplication"("invoiceId");
CREATE UNIQUE INDEX "CheckoutApplication_paymentId_key" ON "CheckoutApplication"("paymentId");
CREATE UNIQUE INDEX "CheckoutApplication_subscriptionId_key" ON "CheckoutApplication"("subscriptionId");
CREATE INDEX "CheckoutApplication_status_expiresAt_idx" ON "CheckoutApplication"("status", "expiresAt");
CREATE INDEX "CheckoutApplication_createdAt_idx" ON "CheckoutApplication"("createdAt");
CREATE UNIQUE INDEX "AccountInvitation_tokenHash_key" ON "AccountInvitation"("tokenHash");
CREATE INDEX "AccountInvitation_userId_status_expiresAt_idx" ON "AccountInvitation"("userId", "status", "expiresAt");
CREATE INDEX "AccountInvitation_createdByUserId_createdAt_idx" ON "AccountInvitation"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "Customer_stripeCustomerId_key" ON "Customer"("stripeCustomerId");
CREATE INDEX "InternetPlan_isPublic_isAvailable_tierRank_idx" ON "InternetPlan"("isPublic", "isAvailable", "tierRank");

ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CheckoutApplication" ADD CONSTRAINT "CheckoutApplication_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InternetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutApplication" ADD CONSTRAINT "CheckoutApplication_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutApplication" ADD CONSTRAINT "CheckoutApplication_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutApplication" ADD CONSTRAINT "CheckoutApplication_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutApplication" ADD CONSTRAINT "CheckoutApplication_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountInvitation" ADD CONSTRAINT "AccountInvitation_checkoutApplicationId_fkey"
FOREIGN KEY ("checkoutApplicationId") REFERENCES "CheckoutApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
