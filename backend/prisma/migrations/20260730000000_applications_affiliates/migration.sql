-- CreateEnum
CREATE TYPE "OfferApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AffiliateRelationshipStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- AlterTable
ALTER TABLE "CreatorKitAsset"
ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CreatorKitScenario"
ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OfferApplication" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "message" VARCHAR(2000),
    "status" "OfferApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateRelationship" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "affiliateCode" VARCHAR(64) NOT NULL,
    "promoCode" VARCHAR(12) NOT NULL,
    "destinationUrl" VARCHAR(2000) NOT NULL,
    "status" "AffiliateRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferApplication_creatorId_status_createdAt_idx"
ON "OfferApplication"("creatorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OfferApplication_offerId_status_createdAt_idx"
ON "OfferApplication"("offerId", "status", "createdAt");

-- Only one unresolved application is allowed for an offer/creator pair.
CREATE UNIQUE INDEX "OfferApplication_one_pending"
ON "OfferApplication"("offerId", "creatorId")
WHERE "status" = 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateRelationship_applicationId_key"
ON "AffiliateRelationship"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateRelationship_affiliateCode_key"
ON "AffiliateRelationship"("affiliateCode");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateRelationship_promoCode_key"
ON "AffiliateRelationship"("promoCode");

-- CreateIndex
CREATE INDEX "AffiliateRelationship_creatorId_status_createdAt_idx"
ON "AffiliateRelationship"("creatorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AffiliateRelationship_offerId_status_createdAt_idx"
ON "AffiliateRelationship"("offerId", "status", "createdAt");

-- ACTIVE and PAUSED are both resumable, so only one live relationship may exist.
CREATE UNIQUE INDEX "AffiliateRelationship_one_live"
ON "AffiliateRelationship"("offerId", "creatorId")
WHERE "status" IN ('ACTIVE', 'PAUSED');

-- AddForeignKey
ALTER TABLE "OfferApplication"
ADD CONSTRAINT "OfferApplication_offerId_fkey"
FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplication"
ADD CONSTRAINT "OfferApplication_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplication"
ADD CONSTRAINT "OfferApplication_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateRelationship"
ADD CONSTRAINT "AffiliateRelationship_offerId_fkey"
FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateRelationship"
ADD CONSTRAINT "AffiliateRelationship_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateRelationship"
ADD CONSTRAINT "AffiliateRelationship_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
