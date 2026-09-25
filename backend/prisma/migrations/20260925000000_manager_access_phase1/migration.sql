-- Additive Phase 1 manager access foundation.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

CREATE TABLE "ManagerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "jobTitle" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrandManagerAssignment" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "managerId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "assignedBy" UUID,
    "removedBy" UUID,
    CONSTRAINT "BrandManagerAssignment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Offer"
  ADD COLUMN "createdByManagerId" UUID,
  ADD COLUMN "currentManagerId" UUID;

ALTER TABLE "AffiliateRelationship"
  ADD COLUMN "currentManagerId" UUID;

ALTER TABLE "Order"
  ADD COLUMN "managerIdAtAttribution" UUID;

CREATE UNIQUE INDEX "ManagerProfile_userId_key" ON "ManagerProfile"("userId");
CREATE INDEX "BrandManagerAssignment_brandId_removedAt_idx"
  ON "BrandManagerAssignment"("brandId", "removedAt");
CREATE INDEX "BrandManagerAssignment_managerId_removedAt_idx"
  ON "BrandManagerAssignment"("managerId", "removedAt");
CREATE UNIQUE INDEX "BrandManagerAssignment_active_brand_manager_key"
  ON "BrandManagerAssignment"("brandId", "managerId")
  WHERE "removedAt" IS NULL;
CREATE INDEX "Offer_createdByManagerId_idx" ON "Offer"("createdByManagerId");
CREATE INDEX "Offer_currentManagerId_idx" ON "Offer"("currentManagerId");
CREATE INDEX "AffiliateRelationship_currentManagerId_idx"
  ON "AffiliateRelationship"("currentManagerId");
CREATE INDEX "Order_managerIdAtAttribution_idx"
  ON "Order"("managerIdAtAttribution");

ALTER TABLE "ManagerProfile"
  ADD CONSTRAINT "ManagerProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BrandManagerAssignment"
  ADD CONSTRAINT "BrandManagerAssignment_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BrandManagerAssignment_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BrandManagerAssignment_assignedBy_fkey"
  FOREIGN KEY ("assignedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BrandManagerAssignment_removedBy_fkey"
  FOREIGN KEY ("removedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_createdByManagerId_fkey"
  FOREIGN KEY ("createdByManagerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Offer_currentManagerId_fkey"
  FOREIGN KEY ("currentManagerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AffiliateRelationship"
  ADD CONSTRAINT "AffiliateRelationship_currentManagerId_fkey"
  FOREIGN KEY ("currentManagerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_managerIdAtAttribution_fkey"
  FOREIGN KEY ("managerIdAtAttribution") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
