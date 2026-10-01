CREATE TYPE "NotificationSeverity" AS ENUM (
  'INFO',
  'SUCCESS',
  'WARNING',
  'CRITICAL',
  'ACTION_REQUIRED'
);

CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "severity" "NotificationSeverity" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "actionUrl" VARCHAR(500),
  "entityType" VARCHAR(100),
  "entityId" VARCHAR(255),
  "metadata" JSONB,
  "deduplicationKey" VARCHAR(190),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Notification_userId_deduplicationKey_key"
  ON "Notification"("userId", "deduplicationKey");

CREATE INDEX "Notification_userId_isRead_createdAt_idx"
  ON "Notification"("userId", "isRead", "createdAt");

CREATE INDEX "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt");

CREATE INDEX "Notification_entityType_entityId_idx"
  ON "Notification"("entityType", "entityId");

