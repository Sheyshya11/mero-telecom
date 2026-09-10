-- CreateEnum
CREATE TYPE "InternalRequestType" AS ENUM ('REFUND_REVIEW', 'BILLING_REVIEW', 'SUBSCRIPTION_ACTION', 'CUSTOMER_ACCOUNT_ACTION', 'PLAN_CHANGE_REVIEW', 'SUPPORT_ASSISTANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "InternalRequestStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'MORE_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InternalRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "InternalRequestSequence" (
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    CONSTRAINT "InternalRequestSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "InternalRequest" (
    "id" UUID NOT NULL,
    "requestNumber" VARCHAR(32) NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "requesterRole" "Role" NOT NULL,
    "targetRole" "Role" NOT NULL DEFAULT 'ADMIN',
    "assignedToUserId" UUID,
    "reviewedByUserId" UUID,
    "type" "InternalRequestType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "priority" "InternalRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "InternalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "supportCaseId" UUID,
    "customerId" UUID,
    "subscriptionId" UUID,
    "invoiceId" UUID,
    "paymentId" UUID,
    "refundId" UUID,
    "planChangeRequestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "InternalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRequestMessage" (
    "id" UUID NOT NULL,
    "internalRequestId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderRole" "Role" NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InternalRequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalRequest_requestNumber_key" ON "InternalRequest"("requestNumber");
CREATE INDEX "InternalRequest_requestedByUserId_updatedAt_id_idx" ON "InternalRequest"("requestedByUserId", "updatedAt", "id");
CREATE INDEX "InternalRequest_assignedToUserId_status_updatedAt_idx" ON "InternalRequest"("assignedToUserId", "status", "updatedAt");
CREATE INDEX "InternalRequest_targetRole_status_priority_createdAt_idx" ON "InternalRequest"("targetRole", "status", "priority", "createdAt");
CREATE INDEX "InternalRequest_customerId_createdAt_idx" ON "InternalRequest"("customerId", "createdAt");
CREATE INDEX "InternalRequest_supportCaseId_idx" ON "InternalRequest"("supportCaseId");
CREATE INDEX "InternalRequest_invoiceId_idx" ON "InternalRequest"("invoiceId");
CREATE INDEX "InternalRequest_paymentId_idx" ON "InternalRequest"("paymentId");
CREATE INDEX "InternalRequest_refundId_idx" ON "InternalRequest"("refundId");
CREATE INDEX "InternalRequest_subscriptionId_idx" ON "InternalRequest"("subscriptionId");
CREATE INDEX "InternalRequest_planChangeRequestId_idx" ON "InternalRequest"("planChangeRequestId");
CREATE INDEX "InternalRequestMessage_internalRequestId_createdAt_id_idx" ON "InternalRequestMessage"("internalRequestId", "createdAt", "id");
CREATE INDEX "InternalRequestMessage_senderUserId_createdAt_idx" ON "InternalRequestMessage"("senderUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_supportCaseId_fkey" FOREIGN KEY ("supportCaseId") REFERENCES "SupportCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequest" ADD CONSTRAINT "InternalRequest_planChangeRequestId_fkey" FOREIGN KEY ("planChangeRequestId") REFERENCES "PlanChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequestMessage" ADD CONSTRAINT "InternalRequestMessage_internalRequestId_fkey" FOREIGN KEY ("internalRequestId") REFERENCES "InternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalRequestMessage" ADD CONSTRAINT "InternalRequestMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
