-- System-user provisioning is additive. Existing users, roles, and account states are preserved.
ALTER TABLE "User"
ADD COLUMN "displayName" VARCHAR(200);

CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" UUID,
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_normalized_key" ON "User" (LOWER("email"));
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");
CREATE UNIQUE INDEX "StaffInvitation_pending_email_role_key"
ON "StaffInvitation" (LOWER("email"), "role")
WHERE "status" = 'PENDING';
CREATE INDEX "StaffInvitation_email_status_expiresAt_idx"
ON "StaffInvitation"("email", "status", "expiresAt");
CREATE INDEX "StaffInvitation_invitedById_createdAt_idx"
ON "StaffInvitation"("invitedById", "createdAt");
CREATE INDEX "StaffInvitation_status_expiresAt_idx"
ON "StaffInvitation"("status", "expiresAt");

ALTER TABLE "StaffInvitation"
ADD CONSTRAINT "StaffInvitation_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffInvitation"
ADD CONSTRAINT "StaffInvitation_acceptedById_fkey"
FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
