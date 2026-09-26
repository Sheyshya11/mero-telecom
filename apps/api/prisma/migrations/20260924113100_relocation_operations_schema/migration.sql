ALTER TABLE "ServiceRelocation"
  ADD COLUMN "statusBeforeManualReview" "ServiceRelocationStatus",
  ADD COLUMN "providerDisconnectionId" VARCHAR(255),
  ADD COLUMN "disconnectionProviderPayload" JSONB,
  ADD COLUMN "nextMockProvisioningOutcome" "MockRelocationOutcome",
  ADD COLUMN "nextMockDisconnectionOutcome" "MockRelocationOutcome",
  ADD COLUMN "disconnectionAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disconnectionFailureReason" VARCHAR(500),
  ADD COLUMN "lastDisconnectionAttemptAt" TIMESTAMP(3);

ALTER TABLE "InternalRequest"
  ADD COLUMN "serviceRelocationId" UUID;

CREATE TABLE "ServiceRelocationNote" (
  "id" UUID NOT NULL,
  "relocationId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "authorRole" "Role" NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceRelocationNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceRelocation_providerDisconnectionId_key"
  ON "ServiceRelocation"("providerDisconnectionId");
CREATE INDEX "ServiceRelocation_oldServiceDisconnectionStatus_updatedAt_id_idx"
  ON "ServiceRelocation"("oldServiceDisconnectionStatus", "updatedAt", "id");
CREATE INDEX "InternalRequest_serviceRelocationId_idx"
  ON "InternalRequest"("serviceRelocationId");
CREATE INDEX "ServiceRelocationNote_relocationId_createdAt_id_idx"
  ON "ServiceRelocationNote"("relocationId", "createdAt", "id");
CREATE INDEX "ServiceRelocationNote_authorUserId_createdAt_idx"
  ON "ServiceRelocationNote"("authorUserId", "createdAt");

DROP INDEX IF EXISTS "ServiceRelocation_one_open_per_subscription";
CREATE UNIQUE INDEX "ServiceRelocation_one_open_per_subscription"
  ON "ServiceRelocation"("subscriptionId")
  WHERE "status" IN (
    'AWAITING_CONFIRMATION',
    'CONFIRMED',
    'PROVISIONING',
    'SCHEDULED',
    'PARTIALLY_COMPLETED',
    'MANUAL_REVIEW_REQUIRED',
    'FAILED'
  );

ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_serviceRelocationId_fkey"
  FOREIGN KEY ("serviceRelocationId") REFERENCES "ServiceRelocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceRelocationNote" ADD CONSTRAINT "ServiceRelocationNote_relocationId_fkey"
  FOREIGN KEY ("relocationId") REFERENCES "ServiceRelocation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServiceRelocationNote" ADD CONSTRAINT "ServiceRelocationNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
