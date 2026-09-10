-- PostgreSQL requires new values added to an existing enum to be committed before
-- they can be referenced in an index predicate, so this intentionally follows the
-- subscription cancellation schema migration.
DROP INDEX IF EXISTS "Subscription_one_active_per_customer";
CREATE UNIQUE INDEX "Subscription_one_active_per_customer"
ON "Subscription"("customerId")
WHERE "status" IN ('ACTIVE', 'SUSPENDED', 'CANCELLATION_PENDING', 'DISCONNECTION_PENDING');
