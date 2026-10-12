-- A later authorized admin extension may permit issuing a previously undelivered recovery notice.
-- Validate against the persisted effective deadline rather than the immutable original 48-hour window.
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_recovery_warning_before_deadline";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recovery_warning_before_deadline"
  CHECK ("recoveryFinalWarningSentAt" IS NULL OR
    ("recoverySuspensionDeadline" IS NOT NULL AND "suspensionScheduledAt" IS NOT NULL AND
     "recoveryFinalWarningSentAt" < "suspensionScheduledAt"));
