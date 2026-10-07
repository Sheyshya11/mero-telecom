-- Preserve operational commitments made under the former customer-confirmation workflow.
UPDATE "CancellationRequest" SET "reviewDecision" = 'APPROVED', "reviewedAt" = "requestedAt", "reviewedByUserId" = CASE WHEN "requestedByRole" IN ('STAFF','ADMIN','SUPER_ADMIN') THEN "requestedByUserId" ELSE NULL END, "reviewNotes" = 'Legacy cancellation already authorized under the former workflow; no employee review is implied.';
UPDATE "ServiceRelocation" SET "reviewDecision" = 'APPROVED', "reviewedAt" = COALESCE("confirmedAt", "createdAt"), "reviewNotes" = 'Legacy relocation already confirmed under the former workflow; no employee review is implied.' WHERE "status" <> 'AWAITING_CONFIRMATION';
UPDATE "ServiceRelocation" SET "status" = 'PENDING_REVIEW' WHERE "status" = 'AWAITING_CONFIRMATION';
ALTER TABLE "CancellationRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
ALTER TABLE "ServiceRelocation" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
DROP INDEX "CancellationRequest_one_open_per_subscription";
CREATE UNIQUE INDEX "CancellationRequest_one_open_per_subscription" ON "CancellationRequest"("subscriptionId") WHERE "status" IN ('PENDING_REVIEW','REQUESTED','SCHEDULED','PROCESSING','DISCONNECTION_PENDING','FAILED');
DROP INDEX "ServiceRelocation_one_open_per_subscription";
CREATE UNIQUE INDEX "ServiceRelocation_one_open_per_subscription" ON "ServiceRelocation"("subscriptionId") WHERE "status" IN ('PENDING_REVIEW','AWAITING_CONFIRMATION','CONFIRMED','PROVISIONING','SCHEDULED','PARTIALLY_COMPLETED','MANUAL_REVIEW_REQUIRED','FAILED');
