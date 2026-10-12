-- Extend the existing subscription hold without replacing collection or service states.
ALTER TABLE "Subscription"
 ADD COLUMN "collectionHoldNotes" VARCHAR(2000),
 ADD COLUMN "collectionHoldUntil" TIMESTAMP(3),
 ADD COLUMN "collectionHoldCreatedBy" UUID,
 ADD COLUMN "collectionHoldCreatedAt" TIMESTAMP(3),
 ADD COLUMN "collectionHoldReleasedBy" UUID,
 ADD COLUMN "collectionHoldReleasedAt" TIMESTAMP(3);
-- Legacy reason-only holds remain indefinite. Preserve their last known modification time.
UPDATE "Subscription" SET "collectionHoldCreatedAt"="updatedAt"
 WHERE "collectionHoldReason" IS NOT NULL AND length(trim("collectionHoldReason"))>0;
