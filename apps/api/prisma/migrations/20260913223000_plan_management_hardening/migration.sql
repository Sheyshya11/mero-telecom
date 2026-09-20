ALTER TABLE "InternetPlan"
ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "InternetPlan"
ALTER COLUMN "isPublic" SET DEFAULT false,
ALTER COLUMN "isAvailable" SET DEFAULT false;

-- Repair legacy lifecycle combinations and prevent existing catalogue entries
-- from remaining orderable without a speed-compatible active coverage rule.
UPDATE "InternetPlan"
SET "isPublic" = false,
    "isAvailable" = false,
    "isFeatured" = false
WHERE "isActive" = false;

UPDATE "InternetPlan"
SET "isAvailable" = false,
    "isFeatured" = false
WHERE "isPublic" = false;

UPDATE "InternetPlan" AS plan
SET "isAvailable" = false,
    "isFeatured" = false
WHERE plan."isPublic" = true
  AND plan."isAvailable" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "PlanCoverageRule" AS rule
    WHERE rule."planId" = plan."id"
      AND rule."isActive" = true
      AND (rule."maximumSpeedMbps" IS NULL OR rule."maximumSpeedMbps" >= plan."downloadMbps")
  );

CREATE UNIQUE INDEX "InternetPlan_normalized_name_key"
ON "InternetPlan" (LOWER(BTRIM("name")));

ALTER TABLE "Subscription"
ADD COLUMN "monthlyCents" INTEGER;

UPDATE "Subscription" AS subscription
SET "monthlyCents" = plan."monthlyCents"
FROM "InternetPlan" AS plan
WHERE subscription."planId" = plan."id";

ALTER TABLE "Subscription"
ALTER COLUMN "monthlyCents" SET NOT NULL;

ALTER TABLE "PlanCoverageRule"
DROP CONSTRAINT "PlanCoverageRule_planId_fkey";

ALTER TABLE "PlanCoverageRule"
ADD CONSTRAINT "PlanCoverageRule_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InternetPlan"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
