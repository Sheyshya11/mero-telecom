-- Support bounded newest-first list scans with a deterministic ID tie-breaker.
-- Existing unique email/account indexes and relation/status indexes are retained.
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt", "id");
CREATE INDEX "Customer_createdAt_id_idx" ON "Customer"("createdAt", "id");
CREATE INDEX "Customer_state_postcode_idx" ON "Customer"("state", "postcode");
CREATE INDEX "Subscription_createdAt_id_idx" ON "Subscription"("createdAt", "id");
CREATE INDEX "Invoice_createdAt_id_idx" ON "Invoice"("createdAt", "id");
CREATE INDEX "Refund_createdAt_id_idx" ON "Refund"("createdAt", "id");
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");
