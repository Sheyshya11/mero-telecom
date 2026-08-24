ALTER TABLE "Invoice" ADD COLUMN "purchasePlanId" UUID;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_purchasePlanId_fkey"
FOREIGN KEY ("purchasePlanId") REFERENCES "InternetPlan"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Invoice_purchasePlanId_idx" ON "Invoice"("purchasePlanId");

-- A customer can only have one unpaid plan purchase at a time. This closes the
-- race where two Checkout Sessions could both be paid before either webhook ran.
CREATE UNIQUE INDEX "Invoice_one_open_plan_purchase_per_customer"
ON "Invoice"("customerId")
WHERE "purchasePlanId" IS NOT NULL AND "status" IN ('ISSUED', 'OVERDUE');
