-- Additive Phase 4B manager invitation links.
CREATE TYPE "ManagerInvitationStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "ManagerInvitation" (
  "id" UUID NOT NULL,
  "brandId" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "status" "ManagerInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedByUserId" UUID NOT NULL,
  "acceptedByUserId" UUID,
  CONSTRAINT "ManagerInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagerInvitation_tokenHash_key"
  ON "ManagerInvitation"("tokenHash");
CREATE UNIQUE INDEX "ManagerInvitation_pending_brand_email_key"
  ON "ManagerInvitation"("brandId", "email")
  WHERE "status" = 'PENDING';
CREATE INDEX "ManagerInvitation_brandId_status_createdAt_idx"
  ON "ManagerInvitation"("brandId", "status", "createdAt");
CREATE INDEX "ManagerInvitation_email_status_idx"
  ON "ManagerInvitation"("email", "status");
CREATE INDEX "ManagerInvitation_status_expiresAt_idx"
  ON "ManagerInvitation"("status", "expiresAt");

ALTER TABLE "ManagerInvitation"
  ADD CONSTRAINT "ManagerInvitation_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ManagerInvitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ManagerInvitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
