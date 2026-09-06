-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RefundStatus" ADD VALUE 'DRAFT';
ALTER TYPE "RefundStatus" ADD VALUE 'MORE_INFORMATION_REQUIRED';

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "customerMessage" VARCHAR(2000);

-- CreateTable
CREATE TABLE "RefundAttachment" (
    "id" UUID NOT NULL,
    "refundId" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "uploadedByRole" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RefundAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundAttachment_refundId_createdAt_idx" ON "RefundAttachment"("refundId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundAttachment_uploadedById_createdAt_idx" ON "RefundAttachment"("uploadedById", "createdAt");

-- AddForeignKey
ALTER TABLE "RefundAttachment" ADD CONSTRAINT "RefundAttachment_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttachment" ADD CONSTRAINT "RefundAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
