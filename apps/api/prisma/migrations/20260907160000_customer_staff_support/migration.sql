-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('INTERNET_CONNECTION', 'BILLING', 'PLAN', 'ACCOUNT', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "SupportCaseSequence" (
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    CONSTRAINT "SupportCaseSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "caseNumber" VARCHAR(32) NOT NULL,
    "customerId" UUID NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" UUID NOT NULL,
    "supportCaseId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderRole" "Role" NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_caseNumber_key" ON "SupportCase"("caseNumber");
CREATE INDEX "SupportCase_customerId_updatedAt_id_idx" ON "SupportCase"("customerId", "updatedAt", "id");
CREATE INDEX "SupportCase_status_updatedAt_id_idx" ON "SupportCase"("status", "updatedAt", "id");
CREATE INDEX "SupportCase_assignedToUserId_status_updatedAt_idx" ON "SupportCase"("assignedToUserId", "status", "updatedAt");
CREATE INDEX "SupportCase_category_status_idx" ON "SupportCase"("category", "status");
CREATE INDEX "SupportMessage_supportCaseId_createdAt_id_idx" ON "SupportMessage"("supportCaseId", "createdAt", "id");
CREATE INDEX "SupportMessage_senderUserId_createdAt_idx" ON "SupportMessage"("senderUserId", "createdAt");
CREATE UNIQUE INDEX "SupportAttachment_storageKey_key" ON "SupportAttachment"("storageKey");
CREATE INDEX "SupportAttachment_messageId_createdAt_idx" ON "SupportAttachment"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
