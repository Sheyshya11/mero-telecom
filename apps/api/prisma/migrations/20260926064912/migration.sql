-- DropIndex
DROP INDEX "Invoice_type_status_idx";

-- DropIndex
DROP INDEX "Subscription_billingMode_status_idx";

-- DropIndex
DROP INDEX "Subscription_nextBillingAt_idx";

-- RenameIndex
ALTER INDEX "ServiceRelocation_oldServiceDisconnectionStatus_updatedAt_id_id" RENAME TO "ServiceRelocation_oldServiceDisconnectionStatus_updatedAt_i_idx";
