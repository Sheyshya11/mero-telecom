-- Additive reporting indexes. No financial records or columns are changed.
CREATE INDEX "Invoice_issuedAt_status_idx" ON "Invoice"("issuedAt", "status");
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");
CREATE INDEX "Payment_createdAt_id_idx" ON "Payment"("createdAt", "id");
CREATE INDEX "Refund_status_processedAt_idx" ON "Refund"("status", "processedAt");
CREATE INDEX "PlanChangeRequest_status_appliedAt_idx" ON "PlanChangeRequest"("status", "appliedAt");
