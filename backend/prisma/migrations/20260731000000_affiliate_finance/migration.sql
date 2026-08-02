-- CreateEnum
CREATE TYPE "OrderImportStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'IMPORTED', 'FAILED');
CREATE TYPE "OrderImportRowStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'CONFLICT');
CREATE TYPE "OrderImportAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'RETURNED', 'PARTIALLY_RETURNED');
CREATE TYPE "AttributionSource" AS ENUM ('AFFILIATE_CODE', 'PROMO_CODE', 'CLICK_ID', 'UNATTRIBUTED');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'HOLD', 'AVAILABLE', 'PAID', 'REVERSED');
CREATE TYPE "LedgerEntryType" AS ENUM ('ACCRUAL', 'REVERSAL', 'PAYOUT');
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "AffiliateRelationship"
ADD COLUMN "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "pausedAt" TIMESTAMP(3),
ADD COLUMN "revokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Click" (
  "id" UUID NOT NULL,
  "affiliateRelationshipId" UUID NOT NULL,
  "affiliateCode" VARCHAR(64) NOT NULL,
  "offerId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "landingUrl" VARCHAR(2000) NOT NULL,
  "referrer" VARCHAR(2000),
  "userAgent" VARCHAR(500),
  "ipHash" VARCHAR(64),
  "deduplicationKey" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderImport" (
  "id" UUID NOT NULL,
  "brandId" UUID NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "status" "OrderImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "invalidRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "errorSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OrderImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderImport_counts_check" CHECK (
    "totalRows" >= 0 AND "validRows" >= 0 AND "invalidRows" >= 0 AND
    "duplicateRows" >= 0 AND "validRows" + "invalidRows" + "duplicateRows" <= "totalRows"
  )
);

CREATE TABLE "OrderImportRow" (
  "id" UUID NOT NULL,
  "orderImportId" UUID NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "status" "OrderImportRowStatus" NOT NULL,
  "action" "OrderImportAction" NOT NULL,
  "externalOrderId" VARCHAR(160),
  "orderDate" TIMESTAMP(3),
  "amountKopecks" INTEGER,
  "returnedAmountKopecks" INTEGER,
  "currency" CHAR(3),
  "orderStatus" "OrderStatus",
  "affiliateCode" VARCHAR(64),
  "promoCode" VARCHAR(12),
  "clickId" UUID,
  "offerId" UUID,
  "attributedRelationshipId" UUID,
  "attributionSource" "AttributionSource",
  "existingOrderId" UUID,
  "previewCreatorCommissionKopecks" INTEGER,
  "previewPlatformCommissionKopecks" INTEGER,
  "errors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rawData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderImportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderImportRow_rowNumber_check" CHECK ("rowNumber" > 0),
  CONSTRAINT "OrderImportRow_amounts_check" CHECK (
    ("amountKopecks" IS NULL OR "amountKopecks" >= 0) AND
    ("returnedAmountKopecks" IS NULL OR "returnedAmountKopecks" >= 0) AND
    ("previewCreatorCommissionKopecks" IS NULL OR "previewCreatorCommissionKopecks" >= 0) AND
    ("previewPlatformCommissionKopecks" IS NULL OR "previewPlatformCommissionKopecks" >= 0)
  )
);

CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "brandId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "orderImportId" UUID NOT NULL,
  "affiliateRelationshipId" UUID,
  "externalOrderId" VARCHAR(160) NOT NULL,
  "orderDate" TIMESTAMP(3) NOT NULL,
  "amountKopecks" INTEGER NOT NULL,
  "returnedAmountKopecks" INTEGER NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "status" "OrderStatus" NOT NULL,
  "attributionSource" "AttributionSource" NOT NULL,
  "affiliateCode" VARCHAR(64),
  "promoCode" VARCHAR(12),
  "clickId" UUID,
  "creatorCommissionBps" INTEGER NOT NULL,
  "platformCommissionBps" INTEGER NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_amount_check" CHECK ("amountKopecks" >= 0),
  CONSTRAINT "Order_returned_amount_check" CHECK (
    "returnedAmountKopecks" >= 0 AND "returnedAmountKopecks" <= "amountKopecks"
  ),
  CONSTRAINT "Order_commission_bps_check" CHECK (
    "creatorCommissionBps" BETWEEN 0 AND 10000 AND
    "platformCommissionBps" BETWEEN 0 AND 10000
  ),
  CONSTRAINT "Order_return_status_check" CHECK (
    ("status" = 'RETURNED' AND "returnedAmountKopecks" = "amountKopecks") OR
    ("status" = 'PARTIALLY_RETURNED' AND "returnedAmountKopecks" > 0 AND "returnedAmountKopecks" < "amountKopecks") OR
    ("status" NOT IN ('RETURNED', 'PARTIALLY_RETURNED') AND "returnedAmountKopecks" = 0)
  )
);

CREATE TABLE "Payout" (
  "id" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "amountKopecks" BIGINT NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "paidByUserId" UUID,
  "reference" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payout_amount_check" CHECK ("amountKopecks" > 0)
);

CREATE TABLE "Commission" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "affiliateRelationshipId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "payoutId" UUID,
  "creatorAmountKopecks" INTEGER NOT NULL,
  "platformAmountKopecks" INTEGER NOT NULL,
  "debtAmountKopecks" INTEGER NOT NULL DEFAULT 0,
  "hasPostPayoutDebt" BOOLEAN NOT NULL DEFAULT false,
  "status" "CommissionStatus" NOT NULL,
  "holdUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Commission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Commission_amounts_check" CHECK (
    "creatorAmountKopecks" >= 0 AND "platformAmountKopecks" >= 0 AND "debtAmountKopecks" >= 0
  ),
  CONSTRAINT "Commission_debt_flag_check" CHECK (
    ("hasPostPayoutDebt" = false AND "debtAmountKopecks" = 0) OR
    ("hasPostPayoutDebt" = true AND "debtAmountKopecks" > 0)
  )
);

CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL,
  "commissionId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "payoutId" UUID,
  "type" "LedgerEntryType" NOT NULL,
  "amountKopecks" INTEGER NOT NULL,
  "eventKey" VARCHAR(200) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_sign_check" CHECK (
    ("type" = 'ACCRUAL' AND "amountKopecks" >= 0) OR
    ("type" IN ('REVERSAL', 'PAYOUT') AND "amountKopecks" <= 0)
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "Click_deduplicationKey_key" ON "Click"("deduplicationKey");
CREATE INDEX "Click_affiliateRelationshipId_clickedAt_idx" ON "Click"("affiliateRelationshipId", "clickedAt");
CREATE INDEX "Click_creatorId_clickedAt_idx" ON "Click"("creatorId", "clickedAt");
CREATE INDEX "Click_offerId_clickedAt_idx" ON "Click"("offerId", "clickedAt");
CREATE INDEX "OrderImport_brandId_createdAt_idx" ON "OrderImport"("brandId", "createdAt");
CREATE INDEX "OrderImport_brandId_status_idx" ON "OrderImport"("brandId", "status");
CREATE UNIQUE INDEX "OrderImportRow_orderImportId_rowNumber_key" ON "OrderImportRow"("orderImportId", "rowNumber");
CREATE INDEX "OrderImportRow_orderImportId_status_action_idx" ON "OrderImportRow"("orderImportId", "status", "action");
CREATE INDEX "OrderImportRow_attributedRelationshipId_idx" ON "OrderImportRow"("attributedRelationshipId");
CREATE INDEX "OrderImportRow_existingOrderId_idx" ON "OrderImportRow"("existingOrderId");
CREATE UNIQUE INDEX "Order_brandId_externalOrderId_key" ON "Order"("brandId", "externalOrderId");
CREATE INDEX "Order_brandId_orderDate_idx" ON "Order"("brandId", "orderDate");
CREATE INDEX "Order_offerId_orderDate_idx" ON "Order"("offerId", "orderDate");
CREATE INDEX "Order_affiliateRelationshipId_orderDate_idx" ON "Order"("affiliateRelationshipId", "orderDate");
CREATE INDEX "Order_clickId_idx" ON "Order"("clickId");
CREATE UNIQUE INDEX "Commission_orderId_key" ON "Commission"("orderId");
CREATE INDEX "Commission_creatorId_status_holdUntil_idx" ON "Commission"("creatorId", "status", "holdUntil");
CREATE INDEX "Commission_offerId_status_idx" ON "Commission"("offerId", "status");
CREATE INDEX "Commission_payoutId_idx" ON "Commission"("payoutId");
CREATE INDEX "Commission_hasPostPayoutDebt_updatedAt_idx" ON "Commission"("hasPostPayoutDebt", "updatedAt");
CREATE UNIQUE INDEX "LedgerEntry_eventKey_key" ON "LedgerEntry"("eventKey");
CREATE INDEX "LedgerEntry_creatorId_createdAt_idx" ON "LedgerEntry"("creatorId", "createdAt");
CREATE INDEX "LedgerEntry_commissionId_createdAt_idx" ON "LedgerEntry"("commissionId", "createdAt");
CREATE INDEX "LedgerEntry_payoutId_idx" ON "LedgerEntry"("payoutId");
CREATE INDEX "Payout_creatorId_status_createdAt_idx" ON "Payout"("creatorId", "status", "createdAt");
CREATE INDEX "Payout_status_createdAt_idx" ON "Payout"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Click" ADD CONSTRAINT "Click_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderImport" ADD CONSTRAINT "OrderImport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderImportRow" ADD CONSTRAINT "OrderImportRow_orderImportId_fkey" FOREIGN KEY ("orderImportId") REFERENCES "OrderImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderImportRow" ADD CONSTRAINT "OrderImportRow_attributedRelationshipId_fkey" FOREIGN KEY ("attributedRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderImportRow" ADD CONSTRAINT "OrderImportRow_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderImportRow" ADD CONSTRAINT "OrderImportRow_existingOrderId_fkey" FOREIGN KEY ("existingOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderImportId_fkey" FOREIGN KEY ("orderImportId") REFERENCES "OrderImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
