CREATE TYPE "AccessTechnology" AS ENUM ('FTTP', 'FTTN', 'FTTC', 'HFC', 'FIXED_WIRELESS', 'SATELLITE');
CREATE TYPE "OperatingRegionStatus" AS ENUM ('ACTIVE', 'COMING_SOON', 'DISABLED');
CREATE TYPE "PostcodeCoverageStatus" AS ENUM ('AVAILABLE', 'PARTIAL', 'COMING_SOON', 'UNAVAILABLE');
CREATE TYPE "AddressOverrideStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'MANUAL_REVIEW');
CREATE TYPE "CoverageResultStatus" AS ENUM ('AVAILABLE', 'COMING_SOON', 'NOT_AVAILABLE', 'OUTSIDE_OPERATING_REGION', 'MANUAL_REVIEW');

CREATE TABLE "OperatingRegion" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "stateCode" VARCHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "OperatingRegionStatus" NOT NULL DEFAULT 'DISABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingRegion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OperatingRegion_country_code_uppercase" CHECK ("countryCode" = UPPER("countryCode")),
    CONSTRAINT "OperatingRegion_state_code_uppercase" CHECK ("stateCode" = UPPER("stateCode"))
);

CREATE TABLE "PostcodeCoverage" (
    "id" UUID NOT NULL,
    "operatingRegionId" UUID NOT NULL,
    "postcode" CHAR(4) NOT NULL,
    "status" "PostcodeCoverageStatus" NOT NULL,
    "technology" "AccessTechnology",
    "maximumSpeedMbps" INTEGER,
    "availabilityDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminNotes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostcodeCoverage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PostcodeCoverage_postcode_format" CHECK ("postcode" ~ '^[0-9]{4}$'),
    CONSTRAINT "PostcodeCoverage_positive_speed" CHECK ("maximumSpeedMbps" IS NULL OR "maximumSpeedMbps" > 0)
);

CREATE TABLE "AddressCoverageOverride" (
    "id" UUID NOT NULL,
    "operatingRegionId" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "providerAddressId" VARCHAR(255) NOT NULL,
    "formattedAddress" VARCHAR(500) NOT NULL,
    "stateCode" VARCHAR(3) NOT NULL,
    "postcode" CHAR(4) NOT NULL,
    "status" "AddressOverrideStatus" NOT NULL,
    "technology" "AccessTechnology",
    "maximumSpeedMbps" INTEGER,
    "availabilityDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminNotes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressCoverageOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AddressCoverageOverride_state_code_uppercase" CHECK ("stateCode" = UPPER("stateCode")),
    CONSTRAINT "AddressCoverageOverride_postcode_format" CHECK ("postcode" ~ '^[0-9]{4}$'),
    CONSTRAINT "AddressCoverageOverride_positive_speed" CHECK ("maximumSpeedMbps" IS NULL OR "maximumSpeedMbps" > 0)
);

CREATE TABLE "PlanCoverageRule" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "technology" "AccessTechnology" NOT NULL,
    "minimumSpeedMbps" INTEGER,
    "maximumSpeedMbps" INTEGER,
    "operatingRegionId" UUID,
    "postcode" CHAR(4),
    "scopeKey" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanCoverageRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanCoverageRule_postcode_format" CHECK ("postcode" IS NULL OR "postcode" ~ '^[0-9]{4}$'),
    CONSTRAINT "PlanCoverageRule_positive_minimum" CHECK ("minimumSpeedMbps" IS NULL OR "minimumSpeedMbps" > 0),
    CONSTRAINT "PlanCoverageRule_positive_maximum" CHECK ("maximumSpeedMbps" IS NULL OR "maximumSpeedMbps" > 0),
    CONSTRAINT "PlanCoverageRule_speed_order" CHECK ("minimumSpeedMbps" IS NULL OR "maximumSpeedMbps" IS NULL OR "minimumSpeedMbps" <= "maximumSpeedMbps")
);

CREATE TABLE "CoverageSearch" (
    "id" UUID NOT NULL,
    "requestIdentifier" UUID NOT NULL,
    "resultStatus" "CoverageResultStatus" NOT NULL,
    "stateCode" VARCHAR(3),
    "postcode" CHAR(4),
    "technology" "AccessTechnology",
    "plansReturned" BOOLEAN NOT NULL DEFAULT false,
    "operatingRegionId" UUID,
    "customerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageSearch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoverageSearch_state_code_uppercase" CHECK ("stateCode" IS NULL OR "stateCode" = UPPER("stateCode")),
    CONSTRAINT "CoverageSearch_postcode_format" CHECK ("postcode" IS NULL OR "postcode" ~ '^[0-9]{4}$')
);

CREATE UNIQUE INDEX "OperatingRegion_countryCode_stateCode_key" ON "OperatingRegion"("countryCode", "stateCode");
CREATE INDEX "OperatingRegion_status_idx" ON "OperatingRegion"("status");
CREATE UNIQUE INDEX "PostcodeCoverage_operatingRegionId_postcode_key" ON "PostcodeCoverage"("operatingRegionId", "postcode");
CREATE INDEX "PostcodeCoverage_postcode_isActive_idx" ON "PostcodeCoverage"("postcode", "isActive");
CREATE INDEX "PostcodeCoverage_status_isActive_idx" ON "PostcodeCoverage"("status", "isActive");
CREATE UNIQUE INDEX "AddressCoverageOverride_provider_providerAddressId_key" ON "AddressCoverageOverride"("provider", "providerAddressId");
CREATE INDEX "AddressCoverageOverride_operatingRegionId_postcode_isActive_idx" ON "AddressCoverageOverride"("operatingRegionId", "postcode", "isActive");
CREATE INDEX "AddressCoverageOverride_status_isActive_idx" ON "AddressCoverageOverride"("status", "isActive");
CREATE UNIQUE INDEX "PlanCoverageRule_planId_technology_scopeKey_key" ON "PlanCoverageRule"("planId", "technology", "scopeKey");
CREATE INDEX "PlanCoverageRule_technology_isActive_idx" ON "PlanCoverageRule"("technology", "isActive");
CREATE INDEX "PlanCoverageRule_operatingRegionId_postcode_isActive_idx" ON "PlanCoverageRule"("operatingRegionId", "postcode", "isActive");
CREATE INDEX "CoverageSearch_createdAt_idx" ON "CoverageSearch"("createdAt");
CREATE INDEX "CoverageSearch_resultStatus_createdAt_idx" ON "CoverageSearch"("resultStatus", "createdAt");
CREATE INDEX "CoverageSearch_stateCode_postcode_createdAt_idx" ON "CoverageSearch"("stateCode", "postcode", "createdAt");
CREATE INDEX "CoverageSearch_customerId_createdAt_idx" ON "CoverageSearch"("customerId", "createdAt");

ALTER TABLE "PostcodeCoverage" ADD CONSTRAINT "PostcodeCoverage_operatingRegionId_fkey"
FOREIGN KEY ("operatingRegionId") REFERENCES "OperatingRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AddressCoverageOverride" ADD CONSTRAINT "AddressCoverageOverride_operatingRegionId_fkey"
FOREIGN KEY ("operatingRegionId") REFERENCES "OperatingRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanCoverageRule" ADD CONSTRAINT "PlanCoverageRule_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InternetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanCoverageRule" ADD CONSTRAINT "PlanCoverageRule_operatingRegionId_fkey"
FOREIGN KEY ("operatingRegionId") REFERENCES "OperatingRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoverageSearch" ADD CONSTRAINT "CoverageSearch_operatingRegionId_fkey"
FOREIGN KEY ("operatingRegionId") REFERENCES "OperatingRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CoverageSearch" ADD CONSTRAINT "CoverageSearch_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
