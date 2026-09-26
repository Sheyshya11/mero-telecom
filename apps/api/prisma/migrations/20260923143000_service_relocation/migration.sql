CREATE TYPE "ServiceRelocationStatus" AS ENUM (
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PROVISIONING',
  'SCHEDULED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "ServiceAddress" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "addressLine1" VARCHAR(255) NOT NULL,
  "addressLine2" VARCHAR(255),
  "suburb" VARCHAR(100) NOT NULL,
  "state" VARCHAR(3) NOT NULL,
  "postcode" VARCHAR(10) NOT NULL,
  "countryCode" CHAR(2) NOT NULL DEFAULT 'AU',
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "provider" VARCHAR(50),
  "providerAddressId" VARCHAR(255),
  "externalLocationId" VARCHAR(255),
  "technology" "AccessTechnology",
  "serviceClass" VARCHAR(50),
  "maximumSpeedMbps" INTEGER,
  "qualification" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceAddress_state_uppercase" CHECK ("state" = UPPER("state")),
  CONSTRAINT "ServiceAddress_country_uppercase" CHECK ("countryCode" = UPPER("countryCode")),
  CONSTRAINT "ServiceAddress_positive_speed" CHECK ("maximumSpeedMbps" IS NULL OR "maximumSpeedMbps" > 0)
);

ALTER TABLE "Subscription" ADD COLUMN "currentServiceAddressId" UUID;

CREATE TABLE "ServiceRelocation" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "oldServiceAddressId" UUID NOT NULL,
  "newServiceAddressId" UUID NOT NULL,
  "currentPlanId" UUID NOT NULL,
  "requestedPlanId" UUID NOT NULL,
  "requestedMoveDate" DATE NOT NULL,
  "requestedOldServiceDisconnectionDate" DATE,
  "qualificationStatus" "CoverageResultStatus" NOT NULL,
  "qualification" JSONB NOT NULL,
  "externalLocationId" VARCHAR(255),
  "oldTechnology" "AccessTechnology",
  "newTechnology" "AccessTechnology",
  "serviceClass" VARCHAR(50),
  "installationRequired" BOOLEAN,
  "appointmentRequired" BOOLEAN,
  "status" "ServiceRelocationStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "provisioningStatus" "ServiceProvisioningStatus",
  "oldServiceDisconnectionStatus" "CancellationProviderStatus",
  "providerName" VARCHAR(50) NOT NULL DEFAULT 'MOCK_MNF',
  "providerIdempotencyKey" VARCHAR(180) NOT NULL,
  "providerProvisioningId" VARCHAR(255),
  "providerPayload" JSONB,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" VARCHAR(500),
  "requestedByUserId" UUID NOT NULL,
  "cancelledByUserId" UUID,
  "confirmedAt" TIMESTAMP(3),
  "provisioningStartedAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "newServiceActivatedAt" TIMESTAMP(3),
  "oldServiceDisconnectedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceRelocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceRelocation_dates_order" CHECK (
    "requestedOldServiceDisconnectionDate" IS NULL OR
    "requestedOldServiceDisconnectionDate" >= "requestedMoveDate"
  )
);

CREATE INDEX "ServiceAddress_customerId_createdAt_idx" ON "ServiceAddress"("customerId", "createdAt");
CREATE INDEX "ServiceAddress_provider_providerAddressId_idx" ON "ServiceAddress"("provider", "providerAddressId");
CREATE INDEX "ServiceAddress_externalLocationId_idx" ON "ServiceAddress"("externalLocationId");
CREATE INDEX "Subscription_currentServiceAddressId_idx" ON "Subscription"("currentServiceAddressId");
CREATE UNIQUE INDEX "ServiceRelocation_providerIdempotencyKey_key" ON "ServiceRelocation"("providerIdempotencyKey");
CREATE UNIQUE INDEX "ServiceRelocation_providerProvisioningId_key" ON "ServiceRelocation"("providerProvisioningId");
CREATE UNIQUE INDEX "ServiceRelocation_one_open_per_subscription" ON "ServiceRelocation"("subscriptionId")
WHERE "status" IN ('AWAITING_CONFIRMATION', 'CONFIRMED', 'PROVISIONING', 'SCHEDULED', 'FAILED');
CREATE INDEX "ServiceRelocation_customerId_createdAt_id_idx" ON "ServiceRelocation"("customerId", "createdAt", "id");
CREATE INDEX "ServiceRelocation_subscriptionId_status_createdAt_idx" ON "ServiceRelocation"("subscriptionId", "status", "createdAt");
CREATE INDEX "ServiceRelocation_status_requestedMoveDate_id_idx" ON "ServiceRelocation"("status", "requestedMoveDate", "id");
CREATE INDEX "ServiceRelocation_provisioningStatus_updatedAt_id_idx" ON "ServiceRelocation"("provisioningStatus", "updatedAt", "id");

ALTER TABLE "ServiceAddress" ADD CONSTRAINT "ServiceAddress_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_currentServiceAddressId_fkey"
FOREIGN KEY ("currentServiceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_oldServiceAddressId_fkey"
FOREIGN KEY ("oldServiceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_newServiceAddressId_fkey"
FOREIGN KEY ("newServiceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_currentPlanId_fkey"
FOREIGN KEY ("currentPlanId") REFERENCES "InternetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_requestedPlanId_fkey"
FOREIGN KEY ("requestedPlanId") REFERENCES "InternetPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRelocation" ADD CONSTRAINT "ServiceRelocation_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the current service location for existing subscriptions without
-- mutating the customer profile address records used by older code paths.
INSERT INTO "ServiceAddress" (
  "id", "customerId", "addressLine1", "addressLine2", "suburb", "state", "postcode", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), address."customerId", address."addressLine1", address."addressLine2",
  address."suburb", address."state", address."postcode", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CustomerAddress" address
WHERE address."type" = 'SERVICE'
  AND EXISTS (SELECT 1 FROM "Subscription" subscription WHERE subscription."customerId" = address."customerId");

UPDATE "Subscription" subscription
SET "currentServiceAddressId" = (
  SELECT address."id"
  FROM "ServiceAddress" address
  WHERE address."customerId" = subscription."customerId"
  ORDER BY address."createdAt" ASC, address."id" ASC
  LIMIT 1
);
