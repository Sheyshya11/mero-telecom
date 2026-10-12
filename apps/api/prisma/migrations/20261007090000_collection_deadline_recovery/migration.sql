-- Add recovery state without changing or deleting existing invoices, reminders, or audit records.
ALTER TABLE "Invoice"
  ADD COLUMN "originalSuspensionDeadline" TIMESTAMP(3),
  ADD COLUMN "recoverySuspensionDeadline" TIMESTAMP(3),
  ADD COLUMN "recoveryFinalWarningSentAt" TIMESTAMP(3);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recovery_warning_before_deadline"
  CHECK ("recoveryFinalWarningSentAt" IS NULL OR
    ("recoverySuspensionDeadline" IS NOT NULL AND "recoveryFinalWarningSentAt" < "recoverySuspensionDeadline"));
