ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

CREATE TYPE "SuspensionReason" AS ENUM (
  'NON_PAYMENT',
  'ADMINISTRATIVE',
  'FRAUD',
  'COMPLIANCE',
  'OTHER'
);

CREATE TYPE "ServiceProvisioningAction" AS ENUM ('SUSPEND', 'RESTORE');
CREATE TYPE "ServiceProvisioningStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "Subscription"
  ADD COLUMN "pastDueAt" TIMESTAMP(3),
  ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" "SuspensionReason",
  ADD COLUMN "reactivatedAt" TIMESTAMP(3),
  ADD COLUMN "eligibleForTerminationAt" TIMESTAMP(3),
  ADD COLUMN "terminationReviewQueuedAt" TIMESTAMP(3),
  ADD COLUMN "overdueReminderStage" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "suspensionWarningSentAt" TIMESTAMP(3),
  ADD COLUMN "provisioningStatus" "ServiceProvisioningStatus",
  ADD COLUMN "provisioningFailure" VARCHAR(500);

ALTER TABLE "Invoice" ADD COLUMN "overdueAt" TIMESTAMP(3);

CREATE TABLE "ServiceProvisioningRequest" (
  "id" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "action" "ServiceProvisioningAction" NOT NULL,
  "status" "ServiceProvisioningStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "provider" VARCHAR(50) NOT NULL DEFAULT 'MOCK',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" VARCHAR(500),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ServiceProvisioningRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceProvisioningRequest_idempotencyKey_key"
  ON "ServiceProvisioningRequest"("idempotencyKey");
CREATE INDEX "ServiceProvisioningRequest_status_updatedAt_id_idx"
  ON "ServiceProvisioningRequest"("status", "updatedAt", "id");
CREATE INDEX "ServiceProvisioningRequest_subscriptionId_createdAt_idx"
  ON "ServiceProvisioningRequest"("subscriptionId", "createdAt");
CREATE INDEX "Subscription_status_gracePeriodEndsAt_id_idx"
  ON "Subscription"("status", "gracePeriodEndsAt", "id");
CREATE INDEX "Subscription_status_eligibleForTerminationAt_id_idx"
  ON "Subscription"("status", "eligibleForTerminationAt", "id");

ALTER TABLE "ServiceProvisioningRequest"
  ADD CONSTRAINT "ServiceProvisioningRequest_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
