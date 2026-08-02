CREATE TYPE "CreatorKitAccessLevel" AS ENUM ('DIGITAL', 'PRODUCT');
CREATE TYPE "CreatorKitAssetStatus" AS ENUM ('UPLOADING', 'READY', 'DISABLED', 'DELETED', 'FAILED');
CREATE TYPE "CreatorKitProcessingStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "CreatorKitAssetType" AS ENUM ('PHOTO', 'VERTICAL_VIDEO', 'HORIZONTAL_VIDEO', 'PRODUCT_PNG', 'LOGO', 'LIFESTYLE', 'TEXTURE_VIDEO', 'USAGE_VIDEO', 'BANNER', 'DOCUMENT');
CREATE TYPE "CreatorKitScenarioChannel" AS ENUM ('REELS', 'STORIES', 'TELEGRAM', 'THREADS', 'POST', 'SHORT_REVIEW', 'SELECTION');
CREATE TYPE "CreatorKitFactType" AS ENUM ('DESCRIPTION', 'BENEFITS', 'INGREDIENTS', 'USAGE', 'PRICE', 'VOLUME', 'COUNTRY', 'TARGET_AUDIENCE', 'FEATURES', 'LIMITATIONS');
CREATE TYPE "CreatorKitClaimType" AS ENUM ('ALLOWED', 'FORBIDDEN');

CREATE TABLE "CreatorKit" (
  "id" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitAsset" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "assetType" "CreatorKitAssetType" NOT NULL,
  "accessLevel" "CreatorKitAccessLevel" NOT NULL,
  "status" "CreatorKitAssetStatus" NOT NULL DEFAULT 'UPLOADING',
  "processingStatus" "CreatorKitProcessingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "originalFileName" VARCHAR(255) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "storageObjectKey" VARCHAR(1000) NOT NULL,
  "previewObjectKey" VARCHAR(1000),
  "editable" BOOLEAN NOT NULL DEFAULT false,
  "textAllowed" BOOLEAN NOT NULL DEFAULT false,
  "paidAdsAllowed" BOOLEAN NOT NULL DEFAULT false,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreatorKitAsset_byteSize_check" CHECK ("byteSize" > 0)
);

CREATE TABLE "CreatorKitScenario" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "channel" "CreatorKitScenarioChannel" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "idea" TEXT NOT NULL,
  "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitScenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitFact" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "type" "CreatorKitFactType" NOT NULL,
  "value" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitClaim" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "type" "CreatorKitClaimType" NOT NULL,
  "value" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitRule" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "value" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationRequirements" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "mandatoryMentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "advertisingLabel" TEXT,
  "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "brandMention" VARCHAR(200),
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "allowedPlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationRequirements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorKit_offerId_key" ON "CreatorKit"("offerId");
CREATE UNIQUE INDEX "CreatorKitAsset_storageObjectKey_key" ON "CreatorKitAsset"("storageObjectKey");
CREATE INDEX "CreatorKitAsset_creatorKitId_status_accessLevel_idx" ON "CreatorKitAsset"("creatorKitId", "status", "accessLevel");
CREATE INDEX "CreatorKitAsset_expiresAt_idx" ON "CreatorKitAsset"("expiresAt");
CREATE INDEX "CreatorKitScenario_creatorKitId_accessLevel_sortOrder_idx" ON "CreatorKitScenario"("creatorKitId", "accessLevel", "sortOrder");
CREATE UNIQUE INDEX "CreatorKitFact_creatorKitId_type_key" ON "CreatorKitFact"("creatorKitId", "type");
CREATE INDEX "CreatorKitFact_creatorKitId_sortOrder_idx" ON "CreatorKitFact"("creatorKitId", "sortOrder");
CREATE INDEX "CreatorKitClaim_creatorKitId_type_sortOrder_idx" ON "CreatorKitClaim"("creatorKitId", "type", "sortOrder");
CREATE INDEX "CreatorKitRule_creatorKitId_sortOrder_idx" ON "CreatorKitRule"("creatorKitId", "sortOrder");
CREATE UNIQUE INDEX "PublicationRequirements_creatorKitId_key" ON "PublicationRequirements"("creatorKitId");

ALTER TABLE "CreatorKit" ADD CONSTRAINT "CreatorKit_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorKitAsset" ADD CONSTRAINT "CreatorKitAsset_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorKitScenario" ADD CONSTRAINT "CreatorKitScenario_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorKitFact" ADD CONSTRAINT "CreatorKitFact_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorKitClaim" ADD CONSTRAINT "CreatorKitClaim_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreatorKitRule" ADD CONSTRAINT "CreatorKitRule_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationRequirements" ADD CONSTRAINT "PublicationRequirements_creatorKitId_fkey" FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
