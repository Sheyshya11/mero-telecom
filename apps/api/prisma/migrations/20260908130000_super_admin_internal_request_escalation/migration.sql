-- Extend the existing Internal Request workflow without replacing or deleting records.
CREATE TYPE "InternalRequestLevel" AS ENUM ('ADMIN', 'SUPER_ADMIN');
CREATE TYPE "InternalRequestEventType" AS ENUM (
    'CREATED',
    'ASSIGNED',
    'REVIEW_STARTED',
    'MESSAGE_SENT',
    'MORE_INFO_REQUESTED',
    'APPROVED',
    'REJECTED',
    'ESCALATED',
    'RETURNED',
    'RESOLVED',
    'CLOSED'
);

ALTER TABLE "InternalRequest"
    ADD COLUMN "currentLevel" "InternalRequestLevel" NOT NULL DEFAULT 'ADMIN',
    ADD COLUMN "superAdminAssignedToUserId" UUID,
    ADD COLUMN "escalatedByUserId" UUID,
    ADD COLUMN "escalatedAt" TIMESTAMP(3);

CREATE TABLE "InternalRequestAttachment" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalRequestAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalRequestEvent" (
    "id" UUID NOT NULL,
    "internalRequestId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorRole" "Role" NOT NULL,
    "eventType" "InternalRequestEventType" NOT NULL,
    "fromLevel" "InternalRequestLevel",
    "toLevel" "InternalRequestLevel",
    "comment" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InternalRequestEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalRequestAttachment_storageKey_key" ON "InternalRequestAttachment"("storageKey");
CREATE INDEX "InternalRequestAttachment_messageId_createdAt_idx" ON "InternalRequestAttachment"("messageId", "createdAt");
CREATE INDEX "InternalRequestEvent_internalRequestId_createdAt_id_idx" ON "InternalRequestEvent"("internalRequestId", "createdAt", "id");
CREATE INDEX "InternalRequestEvent_actorUserId_createdAt_idx" ON "InternalRequestEvent"("actorUserId", "createdAt");
CREATE INDEX "InternalRequest_superAdminAssignedToUserId_status_updatedAt_idx" ON "InternalRequest"("superAdminAssignedToUserId", "status", "updatedAt");
CREATE INDEX "InternalRequest_currentLevel_status_priority_escalatedAt_idx" ON "InternalRequest"("currentLevel", "status", "priority", "escalatedAt");

ALTER TABLE "InternalRequest"
    ADD CONSTRAINT "InternalRequest_superAdminAssignedToUserId_fkey"
    FOREIGN KEY ("superAdminAssignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalRequest"
    ADD CONSTRAINT "InternalRequest_escalatedByUserId_fkey"
    FOREIGN KEY ("escalatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalRequestAttachment"
    ADD CONSTRAINT "InternalRequestAttachment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "InternalRequestMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalRequestEvent"
    ADD CONSTRAINT "InternalRequestEvent_internalRequestId_fkey"
    FOREIGN KEY ("internalRequestId") REFERENCES "InternalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalRequestEvent"
    ADD CONSTRAINT "InternalRequestEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconstruct the available workflow history for existing requests from the audit trail.
INSERT INTO "InternalRequestEvent" (
    "id", "internalRequestId", "actorUserId", "actorRole", "eventType", "createdAt"
)
SELECT
    gen_random_uuid(),
    request."id",
    audit."actorUserId",
    CASE
        WHEN audit."action" IN ('INTERNAL_REQUEST_CREATED', 'INTERNAL_REQUEST_STAFF_REPLIED') THEN 'STAFF'::"Role"
        ELSE 'ADMIN'::"Role"
    END,
    CASE audit."action"
        WHEN 'INTERNAL_REQUEST_CREATED' THEN 'CREATED'
        WHEN 'INTERNAL_REQUEST_TAKEN' THEN 'ASSIGNED'
        WHEN 'INTERNAL_REQUEST_REVIEW_STARTED' THEN 'REVIEW_STARTED'
        WHEN 'INTERNAL_REQUEST_INFORMATION_REQUESTED' THEN 'MORE_INFO_REQUESTED'
        WHEN 'INTERNAL_REQUEST_STAFF_REPLIED' THEN 'MESSAGE_SENT'
        WHEN 'INTERNAL_REQUEST_ADMIN_REPLIED' THEN 'MESSAGE_SENT'
        WHEN 'INTERNAL_REQUEST_APPROVED' THEN 'APPROVED'
        WHEN 'INTERNAL_REQUEST_REJECTED' THEN 'REJECTED'
        WHEN 'INTERNAL_REQUEST_RESOLVED' THEN 'RESOLVED'
        WHEN 'INTERNAL_REQUEST_CLOSED' THEN 'CLOSED'
    END::"InternalRequestEventType",
    audit."createdAt"
FROM "InternalRequest" request
JOIN "AuditLog" audit
  ON audit."entityType" = 'InternalRequest'
 AND audit."entityId" = request."id"::text
WHERE audit."actorUserId" IS NOT NULL
  AND audit."action" IN (
      'INTERNAL_REQUEST_CREATED',
      'INTERNAL_REQUEST_TAKEN',
      'INTERNAL_REQUEST_REVIEW_STARTED',
      'INTERNAL_REQUEST_INFORMATION_REQUESTED',
      'INTERNAL_REQUEST_STAFF_REPLIED',
      'INTERNAL_REQUEST_ADMIN_REPLIED',
      'INTERNAL_REQUEST_APPROVED',
      'INTERNAL_REQUEST_REJECTED',
      'INTERNAL_REQUEST_RESOLVED',
      'INTERNAL_REQUEST_CLOSED'
  );

-- Every existing request receives at least one stable timeline origin.
INSERT INTO "InternalRequestEvent" (
    "id", "internalRequestId", "actorUserId", "actorRole", "eventType", "createdAt"
)
SELECT
    gen_random_uuid(),
    request."id",
    request."requestedByUserId",
    request."requesterRole",
    'CREATED'::"InternalRequestEventType",
    request."createdAt"
FROM "InternalRequest" request
WHERE NOT EXISTS (
    SELECT 1
    FROM "InternalRequestEvent" event
    WHERE event."internalRequestId" = request."id"
      AND event."eventType" = 'CREATED'
);
