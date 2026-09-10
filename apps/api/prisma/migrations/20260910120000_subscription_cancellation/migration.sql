ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_PENDING';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'DISCONNECTION_PENDING';

CREATE TYPE "CancellationType" AS ENUM ('END_OF_PERIOD', 'IMMEDIATE');
CREATE TYPE "CancellationReason" AS ENUM (
  'MOVING_HOME',
  'SWITCHING_PROVIDER',
  'PRICE',
  'SERVICE_QUALITY',
  'CONNECTION_PROBLEMS',
  'NO_LONGER_REQUIRED',
  'OTHER'
);
CREATE TYPE "CancellationStatus" AS ENUM (
  'REQUESTED',
  'SCHEDULED',
  'PROCESSING',
  'DISCONNECTION_PENDING',
  'COMPLETED',
  'FAILED',
  'REVOKED'
);
CREATE TYPE "CancellationProviderOperation" AS ENUM (
  'DISCONNECT_SERVICE',
  'WITHDRAW_ACTIVATION'
);
CREATE TYPE "CancellationProviderStatus" AS ENUM (
  'NOT_SUBMITTED',
  'PENDING',
  'COMPLETED',
  'FAILED',
  'MANUAL_REVIEW_REQUIRED',
  'CANCELLED'
);
CREATE TYPE "MockDisconnectionScenario" AS ENUM (
  'SUCCESS',
  'PENDING',
  'FAILED',
  'MANUAL_REVIEW_REQUIRED'
);

CREATE TABLE "CancellationRequestSequence" (
  "year" INTEGER NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "CancellationRequestSequence_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "CancellationRequest" (
  "id" UUID NOT NULL,
  "requestNumber" VARCHAR(32) NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "type" "CancellationType" NOT NULL,
  "reason" "CancellationReason" NOT NULL,
  "reasonDetails" VARCHAR(2000),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestedByUserId" UUID NOT NULL,
  "requestedByRole" "Role" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "status" "CancellationStatus" NOT NULL DEFAULT 'REQUESTED',
  "providerOperation" "CancellationProviderOperation" NOT NULL,
  "subscriptionStatusBefore" "SubscriptionStatus" NOT NULL,
  "providerName" VARCHAR(50) NOT NULL DEFAULT 'MOCK_NBN',
  "providerIdempotencyKey" VARCHAR(150) NOT NULL,
  "providerDisconnectionId" VARCHAR(255),
  "providerStatus" "CancellationProviderStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "providerScenario" "MockDisconnectionScenario",
  "providerPayload" JSONB,
  "providerLastCheckedAt" TIMESTAMP(3),
  "failedReason" VARCHAR(500),
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" UUID,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CancellationNote" (
  "id" UUID NOT NULL,
  "cancellationRequestId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "authorRole" "Role" NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CancellationNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CancellationRequest_requestNumber_key"
ON "CancellationRequest"("requestNumber");
CREATE UNIQUE INDEX "CancellationRequest_providerIdempotencyKey_key"
ON "CancellationRequest"("providerIdempotencyKey");
CREATE UNIQUE INDEX "CancellationRequest_providerDisconnectionId_key"
ON "CancellationRequest"("providerDisconnectionId");
CREATE UNIQUE INDEX "CancellationRequest_one_open_per_subscription"
ON "CancellationRequest"("subscriptionId")
WHERE "status" IN ('REQUESTED', 'SCHEDULED', 'PROCESSING', 'DISCONNECTION_PENDING', 'FAILED');
CREATE INDEX "CancellationRequest_customerId_createdAt_id_idx"
ON "CancellationRequest"("customerId", "createdAt", "id");
CREATE INDEX "CancellationRequest_subscriptionId_createdAt_idx"
ON "CancellationRequest"("subscriptionId", "createdAt");
CREATE INDEX "CancellationRequest_status_effectiveAt_id_idx"
ON "CancellationRequest"("status", "effectiveAt", "id");
CREATE INDEX "CancellationRequest_providerStatus_updatedAt_id_idx"
ON "CancellationRequest"("providerStatus", "updatedAt", "id");
CREATE INDEX "CancellationRequest_reason_createdAt_idx"
ON "CancellationRequest"("reason", "createdAt");
CREATE INDEX "CancellationRequest_type_createdAt_idx"
ON "CancellationRequest"("type", "createdAt");
CREATE INDEX "CancellationNote_cancellationRequestId_createdAt_id_idx"
ON "CancellationNote"("cancellationRequestId", "createdAt", "id");
CREATE INDEX "CancellationNote_authorUserId_createdAt_idx"
ON "CancellationNote"("authorUserId", "createdAt");

ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_revokedByUserId_fkey"
FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CancellationNote" ADD CONSTRAINT "CancellationNote_cancellationRequestId_fkey"
FOREIGN KEY ("cancellationRequestId") REFERENCES "CancellationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CancellationNote" ADD CONSTRAINT "CancellationNote_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
