-- Substring customer searches use ILIKE/contains across these fields. Trigram indexes keep
-- those searches responsive as the customer table grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Customer_customerNumber_trgm_idx"
ON "Customer" USING GIN ("customerNumber" gin_trgm_ops);

CREATE INDEX "Customer_firstName_trgm_idx"
ON "Customer" USING GIN ("firstName" gin_trgm_ops);

CREATE INDEX "Customer_lastName_trgm_idx"
ON "Customer" USING GIN ("lastName" gin_trgm_ops);

CREATE INDEX "Customer_email_trgm_idx"
ON "Customer" USING GIN ("email" gin_trgm_ops);

CREATE INDEX "Customer_phone_trgm_idx"
ON "Customer" USING GIN ("phone" gin_trgm_ops);

CREATE INDEX "Customer_firstName_id_idx" ON "Customer"("firstName", "id");
CREATE INDEX "Customer_updatedAt_id_idx" ON "Customer"("updatedAt", "id");
