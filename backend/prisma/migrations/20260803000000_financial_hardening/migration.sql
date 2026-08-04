ALTER TABLE "OrderImportRow"
RENAME COLUMN "previewCreatorCommissionKopecks" TO "previewCreatorAmountKopecks";

ALTER TABLE "OrderImportRow"
RENAME COLUMN "previewPlatformCommissionKopecks" TO "previewPlatformAmountKopecks";

ALTER TABLE "OrderImportRow"
ADD COLUMN "creatorCommissionBpsSnapshot" INTEGER,
ADD COLUMN "platformCommissionBpsSnapshot" INTEGER;

UPDATE "OrderImportRow" AS row
SET
  "creatorCommissionBpsSnapshot" = COALESCE(
    (SELECT existing."creatorCommissionBps" FROM "Order" AS existing WHERE existing."id" = row."existingOrderId"),
    (SELECT offer."creatorCommissionBps" FROM "Offer" AS offer WHERE offer."id" = row."offerId")
  ),
  "platformCommissionBpsSnapshot" = COALESCE(
    (SELECT existing."platformCommissionBps" FROM "Order" AS existing WHERE existing."id" = row."existingOrderId"),
    (SELECT offer."platformCommissionBps" FROM "Offer" AS offer WHERE offer."id" = row."offerId")
  );

ALTER TABLE "OrderImportRow"
ADD CONSTRAINT "OrderImportRow_commission_bps_snapshot_check" CHECK (
  ("creatorCommissionBpsSnapshot" IS NULL OR "creatorCommissionBpsSnapshot" BETWEEN 0 AND 10000) AND
  ("platformCommissionBpsSnapshot" IS NULL OR "platformCommissionBpsSnapshot" BETWEEN 0 AND 10000)
);

ALTER TABLE "Payout"
ADD COLUMN "cancelledByUserId" UUID,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancellationReason" VARCHAR(500);

ALTER TABLE "Payout"
ADD CONSTRAINT "Payout_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Payout_cancelledByUserId_idx" ON "Payout"("cancelledByUserId");
