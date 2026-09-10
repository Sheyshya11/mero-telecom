-- Create a duplicate-safe role assignment table and preserve every existing role.
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" UUID,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "role")
);

INSERT INTO "UserRole" ("userId", "role", "assignedAt")
SELECT "id", "role", "createdAt" FROM "User";

CREATE INDEX "UserRole_role_userId_idx" ON "UserRole"("role", "userId");

ALTER TABLE "UserRole"
ADD CONSTRAINT "UserRole_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "role";
