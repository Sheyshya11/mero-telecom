-- PostgreSQL requires enum additions to be committed before a new value can be
-- referenced by an index predicate, so this follows the lifecycle migration.
DROP INDEX IF EXISTS "Subscription_one_active_per_customer";
CREATE UNIQUE INDEX "Subscription_one_active_per_customer"
ON "Subscription"("customerId")
WHERE "status" IN (
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLATION_PENDING',
  'DISCONNECTION_PENDING'
);
