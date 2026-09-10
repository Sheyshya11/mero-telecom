-- Extend the existing support case workflow for unauthenticated pre-sales enquiries.
-- Existing customer support records remain CUSTOMER_SUPPORT and retain their relationships.
CREATE TYPE "SupportRequestType" AS ENUM ('CUSTOMER_SUPPORT', 'PROSPECT_ENQUIRY');
CREATE TYPE "SupportMessageVisibility" AS ENUM ('CUSTOMER_VISIBLE', 'INTERNAL');
CREATE TYPE "SupportEmailDeliveryStatus" AS ENUM ('NOT_APPLICABLE', 'QUEUED', 'SENT', 'FAILED');

ALTER TYPE "SupportCategory" ADD VALUE 'PLANS_AND_PRICING';
ALTER TYPE "SupportCategory" ADD VALUE 'NBN_AVAILABILITY';
ALTER TYPE "SupportCategory" ADD VALUE 'ADDRESS_CHECK';
ALTER TYPE "SupportCategory" ADD VALUE 'SIGNUP_HELP';
ALTER TYPE "SupportCategory" ADD VALUE 'ORDER_HELP';
ALTER TYPE "SupportCategory" ADD VALUE 'PAYMENT_HELP';
ALTER TYPE "SupportCategory" ADD VALUE 'GENERAL_ENQUIRY';

ALTER TABLE "SupportCase"
    ADD COLUMN "requestType" "SupportRequestType" NOT NULL DEFAULT 'CUSTOMER_SUPPORT',
    ADD COLUMN "prospectName" VARCHAR(200),
    ADD COLUMN "prospectEmail" VARCHAR(320),
    ADD COLUMN "prospectPhone" VARCHAR(32),
    ADD COLUMN "prospectAddress" VARCHAR(300),
    ADD COLUMN "publicSubmissionKeyHash" CHAR(64),
    ADD COLUMN "linkedCustomerAt" TIMESTAMP(3),
    ADD COLUMN "linkedCustomerByUserId" UUID,
    ALTER COLUMN "customerId" DROP NOT NULL;

ALTER TABLE "SupportMessage"
    ADD COLUMN "visibility" "SupportMessageVisibility" NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    ADD COLUMN "emailDeliveryStatus" "SupportEmailDeliveryStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    ALTER COLUMN "senderUserId" DROP NOT NULL;

ALTER TABLE "SupportMessage" DROP CONSTRAINT "SupportMessage_senderUserId_fkey";
ALTER TABLE "SupportMessage"
    ADD CONSTRAINT "SupportMessage_senderUserId_fkey"
    FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportCase"
    ADD CONSTRAINT "SupportCase_linkedCustomerByUserId_fkey"
    FOREIGN KEY ("linkedCustomerByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SupportCase_publicSubmissionKeyHash_key" ON "SupportCase"("publicSubmissionKeyHash");
CREATE INDEX "SupportCase_requestType_status_updatedAt_id_idx" ON "SupportCase"("requestType", "status", "updatedAt", "id");
CREATE INDEX "SupportCase_prospectEmail_createdAt_idx" ON "SupportCase"("prospectEmail", "createdAt");

-- The shared model permits a prospect to be linked later while preserving its original type.
-- Customer support always requires a customer; prospect enquiries require immutable contact data.
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_context_check" CHECK (
    ("requestType" = 'CUSTOMER_SUPPORT' AND "customerId" IS NOT NULL)
    OR
    ("requestType" = 'PROSPECT_ENQUIRY'
      AND "prospectName" IS NOT NULL
      AND "prospectEmail" IS NOT NULL)
);
