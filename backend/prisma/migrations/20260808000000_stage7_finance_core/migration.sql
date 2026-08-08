-- CreateEnum
CREATE TYPE "CommercialCalculationPolicy" AS ENUM ('LEGACY_DIRECT_RATES_V1', 'POOL_65_35_V1');

-- CreateEnum
CREATE TYPE "ApplicationTermsStatus" AS ENUM ('CURRENT_ACCEPTED', 'REACCEPTANCE_REQUIRED', 'CURRENT_REACCEPTED', 'BOUND');

-- CreateEnum
CREATE TYPE "CreatorApplicationAction" AS ENUM ('ACCEPT_COMMERCIAL_TERMS');

-- CreateEnum
CREATE TYPE "TermsAcceptanceType" AS ENUM ('INITIAL_SUBMISSION', 'UPDATED_TERMS', 'LEGACY_REVIEW');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('ACCRUAL', 'REVERSAL', 'ADJUSTMENT', 'PAYOUT', 'SETTLEMENT', 'RECOVERY');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('BRAND_OBLIGATION', 'CREATOR_PAYABLE', 'PLATFORM_REVENUE', 'CREATOR_RECOVERABLE', 'CASH_CLEARING');

-- CreateEnum
CREATE TYPE "LedgerPostingDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BrandStatementStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'DISPUTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "BrandPaymentStatus" AS ENUM ('RECORDED', 'ALLOCATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancialDisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "CommissionStatus" ADD VALUE 'PAYABLE';
ALTER TYPE "CommissionStatus" ADD VALUE 'DISPUTED';

-- AlterEnum
ALTER TYPE "OfferApplicationStatus" ADD VALUE 'WITHDRAWN';

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "creatorAmountMinor" BIGINT,
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "payableAt" TIMESTAMP(3),
ADD COLUMN     "platformAmountMinor" BIGINT,
ADD COLUMN     "recoverableAmountMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "totalAmountMinor" BIGINT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "currentCommercialTermsId" UUID,
ADD COLUMN     "currentOfferVersionId" UUID;

-- AlterTable
ALTER TABLE "OfferApplication" ADD COLUMN     "applicableCommercialTermsId" UUID,
ADD COLUMN     "creatorActionRequiredAt" TIMESTAMP(3),
ADD COLUMN     "creatorActionResolvedAt" TIMESTAMP(3),
ADD COLUMN     "latestAcceptedTermsId" UUID,
ADD COLUMN     "requiredCreatorAction" "CreatorApplicationAction",
ADD COLUMN     "termsChangedAt" TIMESTAMP(3),
ADD COLUMN     "termsReacceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsStatus" "ApplicationTermsStatus" NOT NULL DEFAULT 'CURRENT_ACCEPTED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "affiliateCommercialAgreementId" UUID,
ADD COLUMN     "amountMinor" BIGINT,
ADD COLUMN     "attributedAt" TIMESTAMP(3),
ADD COLUMN     "attributionIdentifier" VARCHAR(200),
ADD COLUMN     "calculationPolicy" "CommercialCalculationPolicy",
ADD COLUMN     "commercialTermsVersionNumber" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "creatorCommissionAmountMinor" BIGINT,
ADD COLUMN     "creatorPoolShareBps" INTEGER,
ADD COLUMN     "payableAt" TIMESTAMP(3),
ADD COLUMN     "platformCommissionAmountMinor" BIGINT,
ADD COLUMN     "platformPoolShareBps" INTEGER,
ADD COLUMN     "returnedAmountMinor" BIGINT,
ADD COLUMN     "totalCommissionAmountMinor" BIGINT,
ADD COLUMN     "totalCommissionPoolBps" INTEGER;

-- AlterTable
ALTER TABLE "OrderImportRow" ADD COLUMN     "affiliateCommercialAgreementId" UUID,
ADD COLUMN     "calculationPolicySnapshot" "CommercialCalculationPolicy",
ADD COLUMN     "commercialTermsVersionSnapshot" INTEGER,
ADD COLUMN     "creatorPoolShareBpsSnapshot" INTEGER,
ADD COLUMN     "platformPoolShareBpsSnapshot" INTEGER,
ADD COLUMN     "totalCommissionPoolBpsSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'RUB';

-- CreateTable
CREATE TABLE "OfferVersion" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "productUrl" VARCHAR(1000),
    "productPriceMinor" BIGINT NOT NULL,
    "imageId" UUID,
    "promotionWithoutProduct" "PromotionWithoutProduct" NOT NULL,
    "discoveryCategory" VARCHAR(120),
    "discoveryTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedPromotionFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" "OfferStatus" NOT NULL,
    "creatorKitRevisionId" UUID,
    "contentHash" CHAR(64) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialTermsVersion" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "calculationPolicy" "CommercialCalculationPolicy" NOT NULL,
    "totalCommissionPoolBps" INTEGER NOT NULL,
    "splitPolicyCode" VARCHAR(80) NOT NULL,
    "creatorPoolShareBps" INTEGER NOT NULL,
    "platformPoolShareBps" INTEGER NOT NULL,
    "creatorEffectiveGmvBps" INTEGER NOT NULL,
    "platformEffectiveGmvBps" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "attributionPolicySnapshot" JSONB NOT NULL,
    "attributionWindowSnapshot" JSONB NOT NULL,
    "commissionEligibilitySnapshot" JSONB NOT NULL,
    "confirmationPolicySnapshot" JSONB NOT NULL,
    "returnPolicySnapshot" JSONB NOT NULL,
    "cancellationPolicySnapshot" JSONB NOT NULL,
    "payoutPolicySnapshot" JSONB NOT NULL,
    "payoutScheduleSnapshot" JSONB NOT NULL,
    "settlementModelSnapshot" JSONB NOT NULL,
    "minimumPayoutMinor" BIGINT NOT NULL,
    "contractFingerprint" CHAR(64) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialTermsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferApplicationTermsObservation" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "observedOfferVersionId" UUID,
    "commercialTermsVersionId" UUID NOT NULL,
    "calculationPolicy" "CommercialCalculationPolicy" NOT NULL,
    "totalCommissionPoolBps" INTEGER NOT NULL,
    "creatorPoolShareBps" INTEGER NOT NULL,
    "platformPoolShareBps" INTEGER NOT NULL,
    "displayedCreatorEffectiveBps" INTEGER NOT NULL,
    "displayedPlatformEffectiveBps" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "attributionPolicySnapshot" JSONB NOT NULL,
    "confirmationPolicySnapshot" JSONB NOT NULL,
    "returnPolicySnapshot" JSONB NOT NULL,
    "payoutPolicySnapshot" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferApplicationTermsObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferApplicationTermsAcceptance" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "commercialTermsVersionId" UUID NOT NULL,
    "acceptanceType" "TermsAcceptanceType" NOT NULL,
    "displayedCreatorEffectiveBps" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "actorUserId" UUID NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferApplicationTermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommercialAgreement" (
    "id" UUID NOT NULL,
    "affiliateRelationshipId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "applicationTermsAcceptanceId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "offerVersionIdAtActivation" UUID,
    "commercialTermsVersionId" UUID NOT NULL,
    "commercialTermsVersionNumber" INTEGER NOT NULL,
    "calculationPolicy" "CommercialCalculationPolicy" NOT NULL,
    "totalCommissionPoolBps" INTEGER NOT NULL,
    "creatorPoolShareBps" INTEGER NOT NULL,
    "platformPoolShareBps" INTEGER NOT NULL,
    "creatorEffectiveGmvBps" INTEGER NOT NULL,
    "platformEffectiveGmvBps" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "attributionPolicySnapshot" JSONB NOT NULL,
    "attributionWindowSnapshot" JSONB NOT NULL,
    "commissionEligibilitySnapshot" JSONB NOT NULL,
    "confirmationPolicySnapshot" JSONB NOT NULL,
    "returnPolicySnapshot" JSONB NOT NULL,
    "cancellationPolicySnapshot" JSONB NOT NULL,
    "payoutPolicySnapshot" JSONB NOT NULL,
    "payoutScheduleSnapshot" JSONB NOT NULL,
    "settlementModelSnapshot" JSONB NOT NULL,
    "minimumPayoutMinor" BIGINT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "createdByRequestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommercialAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "accountType" "LedgerAccountType" NOT NULL,
    "ownerType" VARCHAR(80) NOT NULL,
    "ownerId" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "eventKey" VARCHAR(240) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "orderId" UUID,
    "commissionId" UUID,
    "payoutId" UUID,
    "statementId" UUID,
    "source" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500),
    "requestId" VARCHAR(100) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerPosting" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "LedgerPostingDirection" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandStatement" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BrandStatementStatus" NOT NULL DEFAULT 'DRAFT',
    "creatorObligationsMinor" BIGINT NOT NULL DEFAULT 0,
    "platformFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "reversalsMinor" BIGINT NOT NULL DEFAULT 0,
    "adjustmentsMinor" BIGINT NOT NULL DEFAULT 0,
    "totalDueMinor" BIGINT NOT NULL DEFAULT 0,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "overdueAt" TIMESTAMP(3),
    "correctedStatementId" UUID,
    "issuedByUserId" UUID,
    "contentHash" CHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandStatementLine" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "orderId" UUID,
    "commissionId" UUID,
    "lineType" VARCHAR(80) NOT NULL,
    "creatorAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "platformAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "adjustmentMinor" BIGINT NOT NULL DEFAULT 0,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandPayment" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" "BrandPaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "reference" VARCHAR(255),
    "paidAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandPaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "commissionId" UUID NOT NULL,
    "affiliateRelationshipId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "recoveryAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDispute" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "commissionId" UUID,
    "statementId" UUID,
    "status" "FinancialDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(1000) NOT NULL,
    "openedByUserId" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" VARCHAR(1000),

    CONSTRAINT "FinancialDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "scope" VARCHAR(80) NOT NULL,
    "currency" CHAR(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "requestId" VARCHAR(100) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" UUID NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" VARCHAR(160) NOT NULL,
    "applicationId" UUID,
    "actorUserId" UUID,
    "recipientUserId" UUID NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "deduplicationKey" VARCHAR(240) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(120),

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotification" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "applicationId" UUID,
    "type" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(160) NOT NULL,
    "titleKey" VARCHAR(160) NOT NULL,
    "messageData" JSONB NOT NULL,
    "actionUrl" VARCHAR(500),
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferVersion_offerId_createdAt_idx" ON "OfferVersion"("offerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferVersion_offerId_version_key" ON "OfferVersion"("offerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OfferVersion_offerId_contentHash_key" ON "OfferVersion"("offerId", "contentHash");

-- CreateIndex
CREATE INDEX "CommercialTermsVersion_offerId_createdAt_idx" ON "CommercialTermsVersion"("offerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialTermsVersion_offerId_version_key" ON "CommercialTermsVersion"("offerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialTermsVersion_offerId_contractFingerprint_key" ON "CommercialTermsVersion"("offerId", "contractFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "OfferApplicationTermsObservation_applicationId_key" ON "OfferApplicationTermsObservation"("applicationId");

-- CreateIndex
CREATE INDEX "OfferApplicationTermsObservation_offerId_submittedAt_idx" ON "OfferApplicationTermsObservation"("offerId", "submittedAt");

-- CreateIndex
CREATE INDEX "OfferApplicationTermsObservation_commercialTermsVersionId_idx" ON "OfferApplicationTermsObservation"("commercialTermsVersionId");

-- CreateIndex
CREATE INDEX "OfferApplicationTermsAcceptance_applicationId_acceptedAt_idx" ON "OfferApplicationTermsAcceptance"("applicationId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferApplicationTermsAcceptance_applicationId_commercialTer_key" ON "OfferApplicationTermsAcceptance"("applicationId", "commercialTermsVersionId", "acceptanceType");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommercialAgreement_affiliateRelationshipId_key" ON "AffiliateCommercialAgreement"("affiliateRelationshipId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommercialAgreement_applicationId_key" ON "AffiliateCommercialAgreement"("applicationId");

-- CreateIndex
CREATE INDEX "AffiliateCommercialAgreement_offerId_activatedAt_idx" ON "AffiliateCommercialAgreement"("offerId", "activatedAt");

-- CreateIndex
CREATE INDEX "AffiliateCommercialAgreement_commercialTermsVersionId_idx" ON "AffiliateCommercialAgreement"("commercialTermsVersionId");

-- CreateIndex
CREATE INDEX "LedgerAccount_ownerType_ownerId_currency_idx" ON "LedgerAccount"("ownerType", "ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_accountType_ownerType_ownerId_currency_key" ON "LedgerAccount"("accountType", "ownerType", "ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_eventKey_key" ON "LedgerTransaction"("eventKey");

-- CreateIndex
CREATE INDEX "LedgerTransaction_orderId_createdAt_idx" ON "LedgerTransaction"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_commissionId_createdAt_idx" ON "LedgerTransaction"("commissionId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_payoutId_createdAt_idx" ON "LedgerTransaction"("payoutId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerTransaction_statementId_createdAt_idx" ON "LedgerTransaction"("statementId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerPosting_transactionId_idx" ON "LedgerPosting"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerPosting_accountId_createdAt_idx" ON "LedgerPosting"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "BrandStatement_brandId_status_dueAt_idx" ON "BrandStatement"("brandId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandStatement_brandId_periodStart_periodEnd_currency_corre_key" ON "BrandStatement"("brandId", "periodStart", "periodEnd", "currency", "correctedStatementId");

-- CreateIndex
CREATE INDEX "BrandStatementLine_statementId_offerId_idx" ON "BrandStatementLine"("statementId", "offerId");

-- CreateIndex
CREATE INDEX "BrandStatementLine_orderId_idx" ON "BrandStatementLine"("orderId");

-- CreateIndex
CREATE INDEX "BrandPayment_brandId_currency_paidAt_idx" ON "BrandPayment"("brandId", "currency", "paidAt");

-- CreateIndex
CREATE INDEX "BrandPaymentAllocation_statementId_idx" ON "BrandPaymentAllocation"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPaymentAllocation_paymentId_statementId_key" ON "BrandPaymentAllocation"("paymentId", "statementId");

-- CreateIndex
CREATE INDEX "PayoutItem_creatorId_currency_idx" ON "PayoutItem"("creatorId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_payoutId_commissionId_key" ON "PayoutItem"("payoutId", "commissionId");

-- CreateIndex
CREATE INDEX "FinancialDispute_brandId_status_openedAt_idx" ON "FinancialDispute"("brandId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "FinancialDispute_orderId_idx" ON "FinancialDispute"("orderId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_checkedAt_idx" ON "ReconciliationRun"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_deduplicationKey_key" ON "NotificationEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "NotificationEvent_processingStatus_occurredAt_idx" ON "NotificationEvent"("processingStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientUserId_occurredAt_idx" ON "NotificationEvent"("recipientUserId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_eventId_key" ON "UserNotification"("eventId");

-- CreateIndex
CREATE INDEX "UserNotification_recipientUserId_readAt_idx" ON "UserNotification"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "UserNotification_recipientUserId_actionRequired_resolvedAt_idx" ON "UserNotification"("recipientUserId", "actionRequired", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_currentOfferVersionId_key" ON "Offer"("currentOfferVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_currentCommercialTermsId_key" ON "Offer"("currentCommercialTermsId");

-- CreateIndex
CREATE INDEX "OfferApplication_creatorId_requiredCreatorAction_creatorAct_idx" ON "OfferApplication"("creatorId", "requiredCreatorAction", "creatorActionRequiredAt");

-- CreateIndex
CREATE INDEX "OfferApplication_applicableCommercialTermsId_idx" ON "OfferApplication"("applicableCommercialTermsId");

-- CreateIndex
CREATE INDEX "OfferApplication_latestAcceptedTermsId_idx" ON "OfferApplication"("latestAcceptedTermsId");

-- CreateIndex
CREATE INDEX "Order_affiliateCommercialAgreementId_orderDate_idx" ON "Order"("affiliateCommercialAgreementId", "orderDate");

-- CreateIndex
CREATE INDEX "OrderImportRow_affiliateCommercialAgreementId_idx" ON "OrderImportRow"("affiliateCommercialAgreementId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_currentOfferVersionId_fkey" FOREIGN KEY ("currentOfferVersionId") REFERENCES "OfferVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_currentCommercialTermsId_fkey" FOREIGN KEY ("currentCommercialTermsId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferVersion" ADD CONSTRAINT "OfferVersion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferVersion" ADD CONSTRAINT "OfferVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTermsVersion" ADD CONSTRAINT "CommercialTermsVersion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTermsVersion" ADD CONSTRAINT "CommercialTermsVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplication" ADD CONSTRAINT "OfferApplication_applicableCommercialTermsId_fkey" FOREIGN KEY ("applicableCommercialTermsId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplication" ADD CONSTRAINT "OfferApplication_latestAcceptedTermsId_fkey" FOREIGN KEY ("latestAcceptedTermsId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsObservation" ADD CONSTRAINT "OfferApplicationTermsObservation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsObservation" ADD CONSTRAINT "OfferApplicationTermsObservation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsObservation" ADD CONSTRAINT "OfferApplicationTermsObservation_observedOfferVersionId_fkey" FOREIGN KEY ("observedOfferVersionId") REFERENCES "OfferVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsObservation" ADD CONSTRAINT "OfferApplicationTermsObservation_commercialTermsVersionId_fkey" FOREIGN KEY ("commercialTermsVersionId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsAcceptance" ADD CONSTRAINT "OfferApplicationTermsAcceptance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsAcceptance" ADD CONSTRAINT "OfferApplicationTermsAcceptance_commercialTermsVersionId_fkey" FOREIGN KEY ("commercialTermsVersionId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApplicationTermsAcceptance" ADD CONSTRAINT "OfferApplicationTermsAcceptance_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommercialAgreement" ADD CONSTRAINT "AffiliateCommercialAgreement_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommercialAgreement" ADD CONSTRAINT "AffiliateCommercialAgreement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommercialAgreement" ADD CONSTRAINT "AffiliateCommercialAgreement_applicationTermsAcceptanceId_fkey" FOREIGN KEY ("applicationTermsAcceptanceId") REFERENCES "OfferApplicationTermsAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommercialAgreement" ADD CONSTRAINT "AffiliateCommercialAgreement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommercialAgreement" ADD CONSTRAINT "AffiliateCommercialAgreement_commercialTermsVersionId_fkey" FOREIGN KEY ("commercialTermsVersionId") REFERENCES "CommercialTermsVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderImportRow" ADD CONSTRAINT "OrderImportRow_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BrandStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatement" ADD CONSTRAINT "BrandStatement_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatement" ADD CONSTRAINT "BrandStatement_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatement" ADD CONSTRAINT "BrandStatement_correctedStatementId_fkey" FOREIGN KEY ("correctedStatementId") REFERENCES "BrandStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatementLine" ADD CONSTRAINT "BrandStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BrandStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatementLine" ADD CONSTRAINT "BrandStatementLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatementLine" ADD CONSTRAINT "BrandStatementLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandStatementLine" ADD CONSTRAINT "BrandStatementLine_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPayment" ADD CONSTRAINT "BrandPayment_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPayment" ADD CONSTRAINT "BrandPayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPaymentAllocation" ADD CONSTRAINT "BrandPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "BrandPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPaymentAllocation" ADD CONSTRAINT "BrandPaymentAllocation_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BrandStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDispute" ADD CONSTRAINT "FinancialDispute_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDispute" ADD CONSTRAINT "FinancialDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDispute" ADD CONSTRAINT "FinancialDispute_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDispute" ADD CONSTRAINT "FinancialDispute_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BrandStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDispute" ADD CONSTRAINT "FinancialDispute_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "OfferApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stage 7 additive legacy backfill.
-- Existing rates remain LEGACY_DIRECT_RATES_V1 and are never converted to POOL_65_35_V1.
INSERT INTO "OfferVersion" (
  "id", "offerId", "version", "title", "description", "productUrl",
  "productPriceMinor", "imageId", "promotionWithoutProduct", "discoveryCategory",
  "allowedPromotionFormats", "visibility", "creatorKitRevisionId", "contentHash",
  "createdByUserId", "requestId", "createdAt"
)
SELECT
  md5('stage7-offer-version:' || offer."id"::text)::uuid,
  offer."id",
  1,
  offer."title",
  offer."description",
  offer."productUrl",
  offer."productPriceKopecks"::bigint,
  offer."imageId",
  offer."promotionWithoutProduct",
  offer."category",
  offer."allowedPromotionFormats",
  offer."status",
  kit."activeRevisionId",
  md5(
    concat_ws('|', offer."title", offer."description", offer."productUrl",
      offer."productPriceKopecks"::text, offer."imageId"::text,
      offer."promotionWithoutProduct"::text, offer."category",
      array_to_string(offer."allowedPromotionFormats", ','),
      offer."status"::text, kit."activeRevisionId"::text)
  ) || md5('content:' || offer."id"::text),
  brand."userId",
  'stage7-legacy-backfill',
  offer."createdAt"
FROM "Offer" offer
JOIN "BrandProfile" brand ON brand."id" = offer."brandId"
LEFT JOIN "CreatorKit" kit ON kit."offerId" = offer."id";

INSERT INTO "CommercialTermsVersion" (
  "id", "offerId", "version", "calculationPolicy", "totalCommissionPoolBps",
  "splitPolicyCode", "creatorPoolShareBps", "platformPoolShareBps",
  "creatorEffectiveGmvBps", "platformEffectiveGmvBps", "currency",
  "attributionPolicySnapshot", "attributionWindowSnapshot",
  "commissionEligibilitySnapshot", "confirmationPolicySnapshot",
  "returnPolicySnapshot", "cancellationPolicySnapshot", "payoutPolicySnapshot",
  "payoutScheduleSnapshot", "settlementModelSnapshot", "minimumPayoutMinor",
  "contractFingerprint", "createdByUserId", "requestId", "createdAt"
)
SELECT
  md5('stage7-commercial-terms:' || offer."id"::text)::uuid,
  offer."id",
  1,
  'LEGACY_DIRECT_RATES_V1',
  LEAST(10000, offer."creatorCommissionBps" + offer."platformCommissionBps"),
  'LEGACY_DIRECT_RATES_V1',
  0,
  0,
  offer."creatorCommissionBps",
  offer."platformCommissionBps",
  'RUB',
  '{"source":"LEGACY","methods":["AFFILIATE_CODE","PROMO_CODE","CLICK_ID"]}'::jsonb,
  '{"source":"LEGACY","windowDays":null}'::jsonb,
  '{"source":"LEGACY","scope":"ALL_OFFER_PRODUCTS"}'::jsonb,
  '{"source":"LEGACY","confirmation":"PAID_ORDER"}'::jsonb,
  '{"source":"LEGACY","returnWindowDays":null}'::jsonb,
  '{"source":"LEGACY","cancelBeforeConfirmation":"NO_COMMISSION"}'::jsonb,
  '{"source":"LEGACY","method":"MANUAL"}'::jsonb,
  '{"source":"LEGACY","schedule":"MANUAL"}'::jsonb,
  '{"source":"LEGACY","model":"MANUAL"}'::jsonb,
  0,
  md5(concat_ws('|', offer."creatorCommissionBps"::text,
    offer."platformCommissionBps"::text, 'RUB', 'LEGACY_DIRECT_RATES_V1'))
    || md5('commercial:' || offer."id"::text),
  brand."userId",
  'stage7-legacy-backfill',
  offer."createdAt"
FROM "Offer" offer
JOIN "BrandProfile" brand ON brand."id" = offer."brandId";

UPDATE "Offer" offer
SET
  "currentOfferVersionId" = md5('stage7-offer-version:' || offer."id"::text)::uuid,
  "currentCommercialTermsId" = md5('stage7-commercial-terms:' || offer."id"::text)::uuid;

INSERT INTO "OfferApplicationTermsObservation" (
  "id", "applicationId", "offerId", "observedOfferVersionId",
  "commercialTermsVersionId", "calculationPolicy", "totalCommissionPoolBps",
  "creatorPoolShareBps", "platformPoolShareBps",
  "displayedCreatorEffectiveBps", "displayedPlatformEffectiveBps", "currency",
  "attributionPolicySnapshot", "confirmationPolicySnapshot",
  "returnPolicySnapshot", "payoutPolicySnapshot", "observedAt", "submittedAt",
  "requestId", "createdAt"
)
SELECT
  md5('stage7-application-observation:' || application."id"::text)::uuid,
  application."id",
  application."offerId",
  offer."currentOfferVersionId",
  terms."id",
  terms."calculationPolicy",
  terms."totalCommissionPoolBps",
  terms."creatorPoolShareBps",
  terms."platformPoolShareBps",
  terms."creatorEffectiveGmvBps",
  terms."platformEffectiveGmvBps",
  terms."currency",
  terms."attributionPolicySnapshot",
  terms."confirmationPolicySnapshot",
  terms."returnPolicySnapshot",
  terms."payoutPolicySnapshot",
  application."createdAt",
  application."createdAt",
  'stage7-legacy-backfill',
  application."createdAt"
FROM "OfferApplication" application
JOIN "Offer" offer ON offer."id" = application."offerId"
JOIN "CommercialTermsVersion" terms ON terms."id" = offer."currentCommercialTermsId";

INSERT INTO "OfferApplicationTermsAcceptance" (
  "id", "applicationId", "commercialTermsVersionId", "acceptanceType",
  "displayedCreatorEffectiveBps", "acceptedAt", "actorUserId", "requestId",
  "source", "createdAt"
)
SELECT
  md5('stage7-application-acceptance:' || application."id"::text)::uuid,
  application."id",
  offer."currentCommercialTermsId",
  'INITIAL_SUBMISSION',
  terms."creatorEffectiveGmvBps",
  application."createdAt",
  creator."userId",
  'stage7-legacy-backfill',
  'LEGACY_ACTIVATED_RELATIONSHIP',
  application."createdAt"
FROM "OfferApplication" application
JOIN "Offer" offer ON offer."id" = application."offerId"
JOIN "CommercialTermsVersion" terms ON terms."id" = offer."currentCommercialTermsId"
JOIN "CreatorProfile" creator ON creator."id" = application."creatorId"
WHERE application."status" = 'APPROVED'
   OR EXISTS (
     SELECT 1 FROM "AffiliateRelationship" relationship
     WHERE relationship."applicationId" = application."id"
   );

UPDATE "OfferApplication" application
SET
  "applicableCommercialTermsId" = offer."currentCommercialTermsId",
  "latestAcceptedTermsId" = CASE
    WHEN application."status" = 'APPROVED' THEN offer."currentCommercialTermsId"
    ELSE NULL
  END,
  "termsStatus" = CASE
    WHEN application."status" = 'APPROVED' THEN 'BOUND'::"ApplicationTermsStatus"
    WHEN application."status" = 'PENDING' THEN 'REACCEPTANCE_REQUIRED'::"ApplicationTermsStatus"
    ELSE 'CURRENT_ACCEPTED'::"ApplicationTermsStatus"
  END,
  "requiredCreatorAction" = CASE
    WHEN application."status" = 'PENDING'
      THEN 'ACCEPT_COMMERCIAL_TERMS'::"CreatorApplicationAction"
    ELSE NULL
  END,
  "creatorActionRequiredAt" = CASE
    WHEN application."status" = 'PENDING' THEN CURRENT_TIMESTAMP
    ELSE NULL
  END,
  "termsChangedAt" = CASE
    WHEN application."status" = 'PENDING' THEN CURRENT_TIMESTAMP
    ELSE NULL
  END
FROM "Offer" offer
WHERE offer."id" = application."offerId";

INSERT INTO "AffiliateCommercialAgreement" (
  "id", "affiliateRelationshipId", "applicationId",
  "applicationTermsAcceptanceId", "offerId", "offerVersionIdAtActivation",
  "commercialTermsVersionId", "commercialTermsVersionNumber",
  "calculationPolicy", "totalCommissionPoolBps", "creatorPoolShareBps",
  "platformPoolShareBps", "creatorEffectiveGmvBps", "platformEffectiveGmvBps",
  "currency", "attributionPolicySnapshot", "attributionWindowSnapshot",
  "commissionEligibilitySnapshot", "confirmationPolicySnapshot",
  "returnPolicySnapshot", "cancellationPolicySnapshot", "payoutPolicySnapshot",
  "payoutScheduleSnapshot", "settlementModelSnapshot", "minimumPayoutMinor",
  "acceptedAt", "approvedAt", "activatedAt", "createdByRequestId", "createdAt"
)
SELECT
  md5('stage7-commercial-agreement:' || relationship."id"::text)::uuid,
  relationship."id",
  relationship."applicationId",
  acceptance."id",
  relationship."offerId",
  offer."currentOfferVersionId",
  terms."id",
  terms."version",
  terms."calculationPolicy",
  terms."totalCommissionPoolBps",
  terms."creatorPoolShareBps",
  terms."platformPoolShareBps",
  terms."creatorEffectiveGmvBps",
  terms."platformEffectiveGmvBps",
  terms."currency",
  terms."attributionPolicySnapshot",
  terms."attributionWindowSnapshot",
  terms."commissionEligibilitySnapshot",
  terms."confirmationPolicySnapshot",
  terms."returnPolicySnapshot",
  terms."cancellationPolicySnapshot",
  terms."payoutPolicySnapshot",
  terms."payoutScheduleSnapshot",
  terms."settlementModelSnapshot",
  terms."minimumPayoutMinor",
  acceptance."acceptedAt",
  COALESCE(application."reviewedAt", relationship."activatedAt"),
  relationship."activatedAt",
  'stage7-legacy-backfill',
  relationship."createdAt"
FROM "AffiliateRelationship" relationship
JOIN "OfferApplication" application ON application."id" = relationship."applicationId"
JOIN "Offer" offer ON offer."id" = relationship."offerId"
JOIN "CommercialTermsVersion" terms ON terms."id" = offer."currentCommercialTermsId"
JOIN "OfferApplicationTermsAcceptance" acceptance
  ON acceptance."applicationId" = application."id";

UPDATE "Order" order_row
SET
  "affiliateCommercialAgreementId" = agreement."id",
  "amountMinor" = order_row."amountKopecks"::bigint,
  "returnedAmountMinor" = order_row."returnedAmountKopecks"::bigint,
  "attributedAt" = order_row."importedAt",
  "attributionIdentifier" = COALESCE(
    order_row."clickId"::text,
    order_row."affiliateCode",
    order_row."promoCode"
  ),
  "calculationPolicy" = 'LEGACY_DIRECT_RATES_V1',
  "commercialTermsVersionNumber" = agreement."commercialTermsVersionNumber",
  "creatorPoolShareBps" = 0,
  "platformPoolShareBps" = 0,
  "totalCommissionPoolBps" = LEAST(
    10000,
    order_row."creatorCommissionBps" + order_row."platformCommissionBps"
  ),
  "creatorCommissionAmountMinor" = (
    SELECT commission."creatorAmountKopecks"::bigint
    FROM "Commission" commission
    WHERE commission."orderId" = order_row."id"
  ),
  "platformCommissionAmountMinor" = (
    SELECT commission."platformAmountKopecks"::bigint
    FROM "Commission" commission
    WHERE commission."orderId" = order_row."id"
  ),
  "totalCommissionAmountMinor" = (
    SELECT
      (commission."creatorAmountKopecks" + commission."platformAmountKopecks")::bigint
    FROM "Commission" commission
    WHERE commission."orderId" = order_row."id"
  ),
  "confirmedAt" = CASE
    WHEN order_row."status" IN ('PAID', 'RETURNED', 'PARTIALLY_RETURNED')
      THEN order_row."importedAt"
    ELSE NULL
  END
FROM "AffiliateCommercialAgreement" agreement
WHERE agreement."affiliateRelationshipId" = order_row."affiliateRelationshipId";

UPDATE "Commission"
SET
  "creatorAmountMinor" = "creatorAmountKopecks"::bigint,
  "platformAmountMinor" = "platformAmountKopecks"::bigint,
  "totalAmountMinor" = ("creatorAmountKopecks" + "platformAmountKopecks")::bigint,
  "recoverableAmountMinor" = "debtAmountKopecks"::bigint,
  "confirmedAt" = CASE
    WHEN "status" IN ('HOLD', 'AVAILABLE', 'PAID', 'REVERSED') THEN "createdAt"
    ELSE NULL
  END,
  "payableAt" = CASE
    WHEN "status" IN ('AVAILABLE', 'PAID') THEN COALESCE("holdUntil", "createdAt")
    ELSE NULL
  END;

UPDATE "OrderImportRow" row
SET
  "affiliateCommercialAgreementId" = agreement."id",
  "calculationPolicySnapshot" = agreement."calculationPolicy",
  "commercialTermsVersionSnapshot" = agreement."commercialTermsVersionNumber",
  "totalCommissionPoolBpsSnapshot" = agreement."totalCommissionPoolBps",
  "creatorPoolShareBpsSnapshot" = agreement."creatorPoolShareBps",
  "platformPoolShareBpsSnapshot" = agreement."platformPoolShareBps"
FROM "AffiliateCommercialAgreement" agreement
WHERE agreement."affiliateRelationshipId" = row."attributedRelationshipId";

INSERT INTO "PayoutItem" (
  "id", "payoutId", "commissionId", "affiliateRelationshipId",
  "creatorId", "amountMinor", "currency", "createdAt"
)
SELECT
  md5('stage7-payout-item:' || commission."id"::text)::uuid,
  commission."payoutId",
  commission."id",
  commission."affiliateRelationshipId",
  commission."creatorId",
  commission."creatorAmountKopecks"::bigint,
  commission."currency",
  commission."createdAt"
FROM "Commission" commission
WHERE commission."payoutId" IS NOT NULL;

INSERT INTO "NotificationEvent" (
  "id", "eventType", "aggregateType", "aggregateId", "applicationId",
  "recipientUserId", "requestId", "deduplicationKey", "payload",
  "occurredAt", "processingStatus", "processedAt"
)
SELECT
  md5('stage7-terms-notification-event:' || application."id"::text)::uuid,
  'APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED',
  'OfferApplication',
  application."id"::text,
  application."id",
  creator."userId",
  'stage7-legacy-backfill',
  'application:' || application."id"::text || ':commercial-terms:'
    || terms."version"::text || ':reacceptance-required',
  jsonb_build_object(
    'applicationId', application."id",
    'offerId', application."offerId",
    'commercialTermsVersionId', terms."id",
    'commercialTermsVersion', terms."version",
    'creatorEffectiveBps', terms."creatorEffectiveGmvBps",
    'legacyReview', true
  ),
  CURRENT_TIMESTAMP,
  'PROCESSED',
  CURRENT_TIMESTAMP
FROM "OfferApplication" application
JOIN "CreatorProfile" creator ON creator."id" = application."creatorId"
JOIN "CommercialTermsVersion" terms
  ON terms."id" = application."applicableCommercialTermsId"
WHERE application."status" = 'PENDING';

INSERT INTO "UserNotification" (
  "id", "eventId", "recipientUserId", "applicationId", "type",
  "entityType", "entityId", "titleKey", "messageData", "actionUrl",
  "actionRequired", "createdAt"
)
SELECT
  md5('stage7-user-notification:' || event."id"::text)::uuid,
  event."id",
  event."recipientUserId",
  event."applicationId",
  event."eventType"::text,
  event."aggregateType",
  event."aggregateId",
  'application.commercialTerms.reacceptanceRequired',
  event."payload",
  '/creator/applications',
  true,
  event."occurredAt"
FROM "NotificationEvent" event
WHERE event."eventType" = 'APPLICATION_COMMERCIAL_TERMS_REACCEPTANCE_REQUIRED';

ALTER TABLE "CommercialTermsVersion"
  ADD CONSTRAINT "CommercialTermsVersion_bps_check" CHECK (
    "totalCommissionPoolBps" BETWEEN 0 AND 10000
    AND "creatorPoolShareBps" BETWEEN 0 AND 10000
    AND "platformPoolShareBps" BETWEEN 0 AND 10000
    AND "creatorEffectiveGmvBps" BETWEEN 0 AND 10000
    AND "platformEffectiveGmvBps" BETWEEN 0 AND 10000
    AND (
      "calculationPolicy" <> 'POOL_65_35_V1'
      OR "creatorPoolShareBps" + "platformPoolShareBps" = 10000
    )
  ),
  ADD CONSTRAINT "CommercialTermsVersion_minimum_payout_check"
    CHECK ("minimumPayoutMinor" >= 0);

ALTER TABLE "OfferApplicationTermsObservation"
  ADD CONSTRAINT "OfferApplicationTermsObservation_bps_check" CHECK (
    "totalCommissionPoolBps" BETWEEN 0 AND 10000
    AND "creatorPoolShareBps" BETWEEN 0 AND 10000
    AND "platformPoolShareBps" BETWEEN 0 AND 10000
    AND "displayedCreatorEffectiveBps" BETWEEN 0 AND 10000
    AND "displayedPlatformEffectiveBps" BETWEEN 0 AND 10000
  );

ALTER TABLE "AffiliateCommercialAgreement"
  ADD CONSTRAINT "AffiliateCommercialAgreement_bps_check" CHECK (
    "totalCommissionPoolBps" BETWEEN 0 AND 10000
    AND "creatorPoolShareBps" BETWEEN 0 AND 10000
    AND "platformPoolShareBps" BETWEEN 0 AND 10000
    AND "creatorEffectiveGmvBps" BETWEEN 0 AND 10000
    AND "platformEffectiveGmvBps" BETWEEN 0 AND 10000
    AND (
      "calculationPolicy" <> 'POOL_65_35_V1'
      OR "creatorPoolShareBps" + "platformPoolShareBps" = 10000
    )
  );

ALTER TABLE "LedgerPosting"
  ADD CONSTRAINT "LedgerPosting_amount_check" CHECK ("amountMinor" > 0);

ALTER TABLE "BrandPayment"
  ADD CONSTRAINT "BrandPayment_amount_check" CHECK ("amountMinor" > 0);

ALTER TABLE "BrandPaymentAllocation"
  ADD CONSTRAINT "BrandPaymentAllocation_amount_check" CHECK ("amountMinor" > 0);

ALTER TABLE "PayoutItem"
  ADD CONSTRAINT "PayoutItem_amount_check" CHECK (
    "amountMinor" >= 0
    AND "recoveryAmountMinor" >= 0
    AND "amountMinor" + "recoveryAmountMinor" > 0
  );

CREATE UNIQUE INDEX "BrandStatement_original_period_key"
  ON "BrandStatement" ("brandId", "periodStart", "periodEnd", "currency")
  WHERE "correctedStatementId" IS NULL;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_returned_amount_minor_check" CHECK (
    "amountMinor" IS NULL
    OR (
      "amountMinor" >= 0
      AND COALESCE("returnedAmountMinor", 0) BETWEEN 0 AND "amountMinor"
    )
  ),
  ADD CONSTRAINT "Order_financial_snapshot_identity_check" CHECK (
    "totalCommissionAmountMinor" IS NULL
    OR (
      "creatorCommissionAmountMinor" IS NOT NULL
      AND "platformCommissionAmountMinor" IS NOT NULL
      AND "totalCommissionAmountMinor" =
        "creatorCommissionAmountMinor" + "platformCommissionAmountMinor"
    )
  );

ALTER TABLE "BrandStatement"
  ADD CONSTRAINT "BrandStatement_amounts_check" CHECK (
    "creatorObligationsMinor" >= 0
    AND "platformFeeMinor" >= 0
    AND "reversalsMinor" >= 0
    AND "totalDueMinor" >= 0
    AND "paidMinor" >= 0
    AND "paidMinor" <= "totalDueMinor"
    AND "totalDueMinor" =
      "creatorObligationsMinor" + "platformFeeMinor"
      - "reversalsMinor" + "adjustmentsMinor"
  );

CREATE FUNCTION "prevent_immutable_financial_mutation"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_financial_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only and cannot be %', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OfferVersion_immutable"
BEFORE UPDATE OR DELETE ON "OfferVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "CommercialTermsVersion_immutable"
BEFORE UPDATE OR DELETE ON "CommercialTermsVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "OfferApplicationTermsObservation_immutable"
BEFORE UPDATE OR DELETE ON "OfferApplicationTermsObservation"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "OfferApplicationTermsAcceptance_immutable"
BEFORE UPDATE OR DELETE ON "OfferApplicationTermsAcceptance"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "AffiliateCommercialAgreement_immutable"
BEFORE UPDATE OR DELETE ON "AffiliateCommercialAgreement"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "LedgerTransaction_immutable"
BEFORE UPDATE OR DELETE ON "LedgerTransaction"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "LedgerPosting_immutable"
BEFORE UPDATE OR DELETE ON "LedgerPosting"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE TRIGGER "PayoutItem_immutable"
BEFORE UPDATE OR DELETE ON "PayoutItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();

CREATE FUNCTION "protect_paid_payout"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_financial_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PAID' THEN
    RAISE EXCEPTION 'PAID payout is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payout_paid_immutable"
BEFORE UPDATE OR DELETE ON "Payout"
FOR EACH ROW EXECUTE FUNCTION "protect_paid_payout"();

CREATE FUNCTION "protect_issued_statement_content"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_financial_cleanup', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Issued statement cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' AND (
    NEW."brandId" IS DISTINCT FROM OLD."brandId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."creatorObligationsMinor" IS DISTINCT FROM OLD."creatorObligationsMinor"
    OR NEW."platformFeeMinor" IS DISTINCT FROM OLD."platformFeeMinor"
    OR NEW."reversalsMinor" IS DISTINCT FROM OLD."reversalsMinor"
    OR NEW."adjustmentsMinor" IS DISTINCT FROM OLD."adjustmentsMinor"
    OR NEW."totalDueMinor" IS DISTINCT FROM OLD."totalDueMinor"
    OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
    OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt"
    OR NEW."correctedStatementId" IS DISTINCT FROM OLD."correctedStatementId"
    OR NEW."issuedByUserId" IS DISTINCT FROM OLD."issuedByUserId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
  ) THEN
    RAISE EXCEPTION 'Issued statement content is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BrandStatement_issued_content_immutable"
BEFORE UPDATE OR DELETE ON "BrandStatement"
FOR EACH ROW EXECUTE FUNCTION "protect_issued_statement_content"();

CREATE TRIGGER "BrandStatementLine_immutable"
BEFORE UPDATE OR DELETE ON "BrandStatementLine"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_financial_mutation"();
