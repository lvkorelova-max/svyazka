CREATE TYPE "OfferImageStatus" AS ENUM (
  'UPLOADING',
  'READY',
  'SUPERSEDED',
  'FAILED',
  'DELETED'
);

ALTER TABLE "Offer"
  ADD COLUMN "imageId" UUID;

CREATE TABLE "OfferImage" (
  "id" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "status" "OfferImageStatus" NOT NULL DEFAULT 'UPLOADING',
  "originalFileName" VARCHAR(255) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "storageObjectKey" VARCHAR(1000) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfferImage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfferImage_byteSize_check" CHECK ("byteSize" > 0)
);

CREATE UNIQUE INDEX "Offer_imageId_key" ON "Offer"("imageId");
CREATE UNIQUE INDEX "OfferImage_storageObjectKey_key" ON "OfferImage"("storageObjectKey");
CREATE INDEX "OfferImage_offerId_status_createdAt_idx"
  ON "OfferImage"("offerId", "status", "createdAt");

ALTER TABLE "OfferImage"
  ADD CONSTRAINT "OfferImage_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "OfferImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
