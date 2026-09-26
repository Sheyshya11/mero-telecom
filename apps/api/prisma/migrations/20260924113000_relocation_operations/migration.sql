-- PostgreSQL requires newly-added enum values to be committed before a later
-- migration can reference them in indexes or constraints.
ALTER TYPE "ServiceRelocationStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_COMPLETED';
ALTER TYPE "ServiceRelocationStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW_REQUIRED';
ALTER TYPE "ServiceRelocationStatus" ADD VALUE IF NOT EXISTS 'FORCE_CLOSED';
ALTER TYPE "InternalRequestType" ADD VALUE IF NOT EXISTS 'RELOCATION_REVIEW';
CREATE TYPE "MockRelocationOutcome" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');
