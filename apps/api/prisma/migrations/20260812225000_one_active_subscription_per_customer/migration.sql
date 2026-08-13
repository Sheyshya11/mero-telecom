CREATE UNIQUE INDEX "Subscription_one_active_per_customer"
ON "Subscription"("customerId")
WHERE "status" = 'ACTIVE';
