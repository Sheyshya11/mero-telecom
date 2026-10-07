-- Enum additions are committed before the next migration uses the new values.
CREATE TYPE "RequestReviewDecision" AS ENUM ('APPROVED', 'REJECTED');
ALTER TYPE "CancellationStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "CancellationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ServiceRelocationStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "ServiceRelocationStatus" ADD VALUE 'REJECTED';
ALTER TABLE "CancellationRequest" ADD COLUMN "reviewDecision" "RequestReviewDecision", ADD COLUMN "reviewedByUserId" UUID, ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewNotes" VARCHAR(2000), ADD COLUMN "rejectionReason" VARCHAR(2000), ADD COLUMN "stripeCancellationSyncedAt" TIMESTAMP(3);
ALTER TABLE "ServiceRelocation" ADD COLUMN "reviewDecision" "RequestReviewDecision", ADD COLUMN "reviewedByUserId" UUID, ADD COLUMN "reviewedAt" TIMESTAMP(3), ADD COLUMN "reviewNotes" VARCHAR(2000), ADD COLUMN "rejectionReason" VARCHAR(2000), ADD COLUMN "requestedBillingAddress" JSONB, ADD COLUMN "customerComments" VARCHAR(2000);
