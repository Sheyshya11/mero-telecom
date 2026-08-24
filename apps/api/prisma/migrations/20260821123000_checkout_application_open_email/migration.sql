DROP INDEX "CheckoutApplication_applicantEmail_key";

CREATE INDEX "CheckoutApplication_applicantEmail_idx"
ON "CheckoutApplication"("applicantEmail");

CREATE UNIQUE INDEX "CheckoutApplication_one_open_email"
ON "CheckoutApplication"("applicantEmail")
WHERE "status" IN ('PENDING_PAYMENT', 'PAYMENT_PROCESSING');
