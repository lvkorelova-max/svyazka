-- CreateEnum
CREATE TYPE "Stage8IntegrationStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CustomerDiscountType" AS ENUM ('NONE', 'PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "CreatorPromoCodeStatus" AS ENUM ('PENDING_PROVISIONING', 'PROVISIONING_CONFIRMED', 'ACTIVE', 'EXPIRED', 'REPLACED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TildaConnectionStatus" AS ENUM ('SETUP_REQUIRED', 'WAITING_FOR_WEBHOOK', 'CHECKING_PAYMENT_PROVIDER', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "TildaPaymentProbeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "Stage8OrderSource" AS ENUM ('CREATOR_LINK', 'CREATOR_PROMO_CODE', 'WEBSITE_TRACKER', 'TILDA', 'CSV_IMPORT', 'SHOPIFY', 'WOOCOMMERCE', 'TIKTOK_SHOP', 'META_CAPI', 'GA4', 'MARKETPLACE', 'MANUAL_CORRECTION', 'LEGACY_BACKFILL');

-- CreateEnum
CREATE TYPE "Stage8OrderEventType" AS ENUM ('ORDER_CREATED', 'PAYMENT_SUCCEEDED', 'PARTIAL_REFUND_SUCCEEDED', 'REFUND_SUCCEEDED', 'ORDER_CANCELLED', 'CHARGEBACK_OPENED', 'CHARGEBACK_REVERSED', 'CHARGEBACK_CONFIRMED');

-- CreateEnum
CREATE TYPE "Stage8EventProcessingStatus" AS ENUM ('RECEIVED', 'ACCEPTED', 'PROCESSING', 'PROCESSED', 'RETRY_PENDING', 'DEAD_LETTER', 'REJECTED', 'DUPLICATE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "Stage8CommerceOrderStatus" AS ENUM ('CREATED', 'PENDING_PAYMENT', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "Stage8EvidenceType" AS ENUM ('SIGNED_ATTRIBUTION_ID', 'CLICK_ID', 'CREATOR_LINK_CODE', 'PROMO_CODE', 'TRACKER_SESSION', 'CSV_IDENTIFIER');

-- CreateEnum
CREATE TYPE "Stage8EvidenceValidationStatus" AS ENUM ('VALID', 'INVALID', 'EXPIRED', 'INELIGIBLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Stage8AttributionStatus" AS ENUM ('PENDING', 'AUTO_ATTRIBUTED', 'UNATTRIBUTED', 'REVIEW_REQUIRED', 'MANUALLY_ATTRIBUTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "Stage8ConfidenceLevel" AS ENUM ('VERIFIED', 'HIGH', 'MEDIUM', 'NONE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "Stage8ExceptionType" AS ENUM ('CONFLICTING_ATTRIBUTION', 'DUPLICATE_CONFLICT', 'UNSUPPORTED_ATTRIBUTION', 'INVALID_AGREEMENT', 'OUTSIDE_WINDOW', 'SUSPICIOUS_FRAUD', 'EVENT_CONFLICT', 'MANUAL_CORRECTION_REQUIRED');

-- CreateEnum
CREATE TYPE "Stage8ExceptionStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "Stage8FinancialHandoffStatus" AS ENUM ('NOT_READY', 'READY', 'ENQUEUED', 'ACKNOWLEDGED', 'RETRY_PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "Stage8OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'RETRY_PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "Stage8TimelineEventType" AS ENUM ('ORDER_EVENT_ACCEPTED', 'ATTRIBUTION_COMPLETED', 'EXCEPTION_OPENED', 'EXCEPTION_RESOLVED', 'FINANCE_HANDOFF_ACCEPTED', 'FINANCE_HANDOFF_FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AttributionSource" ADD VALUE 'WEBSITE_TRACKER';
ALTER TYPE "AttributionSource" ADD VALUE 'CSV_IMPORT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "canonicalOrderKey" VARCHAR(240),
ADD COLUMN     "chargebackOpenedAt" TIMESTAMP(3),
ADD COLUMN     "commerceStatus" "Stage8CommerceOrderStatus",
ADD COLUMN     "currentAttributionResultId" UUID,
ADD COLUMN     "financialHandoffStatus" "Stage8FinancialHandoffStatus" NOT NULL DEFAULT 'NOT_READY',
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "sourceNamespace" VARCHAR(120),
ADD COLUMN     "stage8Source" "Stage8OrderSource",
ALTER COLUMN "orderImportId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FinancialDispute" ADD COLUMN     "openedByType" VARCHAR(40) NOT NULL DEFAULT 'USER',
ALTER COLUMN "openedByUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorType" VARCHAR(40) NOT NULL DEFAULT 'USER',
ALTER COLUMN "actorUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderImport" ADD COLUMN "fileChecksum" CHAR(64);

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow';

-- AlterTable
ALTER TABLE "Offer"
ADD COLUMN "customerDiscountType" "CustomerDiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "customerDiscountBps" INTEGER,
ADD COLUMN "customerDiscountAmountMinor" BIGINT;

-- AlterTable
ALTER TABLE "OfferVersion"
ADD COLUMN "customerDiscountType" "CustomerDiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "customerDiscountBps" INTEGER,
ADD COLUMN "customerDiscountAmountMinor" BIGINT;

ALTER TABLE "AffiliateRelationship" ALTER COLUMN "promoCode" TYPE VARCHAR(20);
ALTER TABLE "OrderImportRow" ALTER COLUMN "promoCode" TYPE VARCHAR(20);
ALTER TABLE "Order" ALTER COLUMN "promoCode" TYPE VARCHAR(20);

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_customer_discount_check" CHECK (
  ("customerDiscountType" = 'NONE' AND "customerDiscountBps" IS NULL AND "customerDiscountAmountMinor" IS NULL)
  OR ("customerDiscountType" = 'PERCENT' AND "customerDiscountBps" BETWEEN 1 AND 10000 AND "customerDiscountAmountMinor" IS NULL)
  OR ("customerDiscountType" = 'FIXED_AMOUNT' AND "customerDiscountBps" IS NULL AND "customerDiscountAmountMinor" > 0)
);

ALTER TABLE "OfferVersion" ADD CONSTRAINT "OfferVersion_customer_discount_check" CHECK (
  ("customerDiscountType" = 'NONE' AND "customerDiscountBps" IS NULL AND "customerDiscountAmountMinor" IS NULL)
  OR ("customerDiscountType" = 'PERCENT' AND "customerDiscountBps" BETWEEN 1 AND 10000 AND "customerDiscountAmountMinor" IS NULL)
  OR ("customerDiscountType" = 'FIXED_AMOUNT' AND "customerDiscountBps" IS NULL AND "customerDiscountAmountMinor" > 0)
);

-- CreateTable
CREATE TABLE "TrackerInstallation" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "publicKey" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "primaryDomain" VARCHAR(255) NOT NULL,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "Stage8IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "consentMode" VARCHAR(40) NOT NULL DEFAULT 'REQUIRED',
    "cookieTtlDays" INTEGER NOT NULL DEFAULT 30,
    "createdByUserId" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "healthStatus" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackerInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TildaIntegration" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "trackerInstallationId" UUID NOT NULL,
    "status" "TildaConnectionStatus" NOT NULL DEFAULT 'SETUP_REQUIRED',
    "encryptedWebhookKey" TEXT NOT NULL,
    "cloudPaymentsPublicId" VARCHAR(160) NOT NULL,
    "encryptedCloudPaymentsApiSecret" TEXT NOT NULL,
    "lastWebhookAt" TIMESTAMP(3),
    "lastWebhookTestAt" TIMESTAMP(3),
    "lastOrderReceivedAt" TIMESTAMP(3),
    "lastPaymentCheckAt" TIMESTAMP(3),
    "lastPaidOrderAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(120),
    "lastErrorAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TildaIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TildaPaymentProbe" (
    "id" UUID NOT NULL,
    "integrationId" UUID NOT NULL,
    "orderEventId" UUID NOT NULL,
    "externalOrderId" VARCHAR(160) NOT NULL,
    "amountMinor" BIGINT,
    "currency" CHAR(3),
    "status" "TildaPaymentProbeStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "transactionId" VARCHAR(160),
    "lastErrorCode" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TildaPaymentProbe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredentialVersion" (
    "id" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "keyId" VARCHAR(80) NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "status" "Stage8IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationCredentialVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorLink" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "affiliateRelationshipId" UUID NOT NULL,
    "affiliateCommercialAgreementId" UUID,
    "code" VARCHAR(80) NOT NULL,
    "destinationUrl" VARCHAR(2000) NOT NULL,
    "status" "Stage8IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPromoCode" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "affiliateRelationshipId" UUID NOT NULL,
    "affiliateCommercialAgreementId" UUID,
    "rawCode" VARCHAR(20) NOT NULL,
    "normalizedCode" VARCHAR(20) NOT NULL,
    "normalizationPolicy" VARCHAR(40) NOT NULL DEFAULT 'NFKC_TRIM_UPPER_V1',
    "discountType" "CustomerDiscountType" NOT NULL,
    "discountBps" INTEGER,
    "discountAmountMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "eligibilitySnapshot" JSONB,
    "status" "CreatorPromoCodeStatus" NOT NULL DEFAULT 'PENDING_PROVISIONING',
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeUntil" TIMESTAMP(3),
    "provisioningConfirmedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "replacementForId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorPromoCode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_normalized_format_check"
CHECK ("normalizedCode" ~ '^[A-Z0-9]{4,20}$');

ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_normalization_policy_check"
CHECK (
  "normalizationPolicy" = 'NFKC_TRIM_UPPER_V1'
  AND "normalizedCode" = upper(normalize(trim("rawCode"), NFKC))
);

ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_discount_check" CHECK (
  ("discountType" = 'NONE' AND "discountBps" IS NULL AND "discountAmountMinor" IS NULL)
  OR ("discountType" = 'PERCENT' AND "discountBps" BETWEEN 1 AND 10000 AND "discountAmountMinor" IS NULL)
  OR ("discountType" = 'FIXED_AMOUNT' AND "discountBps" IS NULL AND "discountAmountMinor" > 0)
);

-- CreateTable
CREATE TABLE "ClickSession" (
    "id" UUID NOT NULL,
    "publicAttributionId" VARCHAR(96) NOT NULL,
    "trackerInstallationId" UUID,
    "creatorLinkId" UUID,
    "creatorPromoCodeId" UUID,
    "clickId" UUID,
    "affiliateRelationshipId" UUID NOT NULL,
    "affiliateCommercialAgreementId" UUID,
    "creatorId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "firstClickedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "landingUrl" VARCHAR(2000),
    "referrerOrigin" VARCHAR(500),
    "utmSnapshot" JSONB,
    "ipHash" VARCHAR(64),
    "userAgentHash" VARCHAR(64),
    "consentState" VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN',
    "status" "Stage8IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClickSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" UUID NOT NULL,
    "trackerInstallationId" UUID NOT NULL,
    "clickSessionId" UUID,
    "externalEventId" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" VARCHAR(500) NOT NULL,
    "payloadVersion" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "processingStatus" "Stage8EventProcessingStatus" NOT NULL DEFAULT 'PROCESSED',

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionRuleSet" (
    "id" UUID NOT NULL,
    "brandId" UUID,
    "offerId" UUID,
    "version" INTEGER NOT NULL,
    "status" "Stage8IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourcePriority" "Stage8OrderSource"[],
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 30,
    "attributionModel" VARCHAR(80) NOT NULL DEFAULT 'LAST_ELIGIBLE_TOUCH',
    "crossCreatorConflictPolicy" VARCHAR(80) NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "cookieTtlDays" INTEGER NOT NULL DEFAULT 30,
    "rules" JSONB NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage8OrderEvent" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "trackerInstallationId" UUID,
    "orderImportId" UUID,
    "orderId" UUID,
    "source" "Stage8OrderSource" NOT NULL,
    "sourceNamespace" VARCHAR(120) NOT NULL,
    "externalEventId" VARCHAR(160) NOT NULL,
    "externalOrderId" VARCHAR(160) NOT NULL,
    "canonicalOrderKey" VARCHAR(240) NOT NULL,
    "eventType" "Stage8OrderEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderCreatedAt" TIMESTAMP(3),
    "amountMinor" BIGINT,
    "refundAmountMinor" BIGINT,
    "currency" CHAR(3),
    "offerIdHint" UUID,
    "attributionId" VARCHAR(96),
    "clickIdHint" VARCHAR(96),
    "creatorLinkCode" VARCHAR(80),
    "promoCode" VARCHAR(80),
    "productLines" JSONB,
    "schemaVersion" VARCHAR(20) NOT NULL DEFAULT '1.0',
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "authenticationContext" JSONB NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "processingStatus" "Stage8EventProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(120),
    "lastErrorMessage" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage8OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionEvidence" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderEventId" UUID NOT NULL,
    "evidenceType" "Stage8EvidenceType" NOT NULL,
    "source" "Stage8OrderSource" NOT NULL,
    "identifierHash" CHAR(64) NOT NULL,
    "clickSessionId" UUID,
    "clickId" UUID,
    "affiliateRelationshipId" UUID,
    "affiliateCommercialAgreementId" UUID,
    "creatorId" UUID,
    "offerId" UUID,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "validationStatus" "Stage8EvidenceValidationStatus" NOT NULL,
    "reasonCode" VARCHAR(120) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionResult" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "decisionVersion" INTEGER NOT NULL,
    "status" "Stage8AttributionStatus" NOT NULL,
    "creatorId" UUID,
    "offerId" UUID,
    "affiliateRelationshipId" UUID,
    "affiliateCommercialAgreementId" UUID,
    "ruleSetId" UUID,
    "ruleSetVersion" INTEGER,
    "confidenceLevel" "Stage8ConfidenceLevel" NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attributedAt" TIMESTAMP(3),
    "decidedByType" VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
    "decidedByUserId" UUID,
    "supersedesResultId" UUID,
    "decisionHash" CHAR(64) NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionException" (
    "id" UUID NOT NULL,
    "brandId" UUID NOT NULL,
    "orderId" UUID,
    "attributionResultId" UUID,
    "type" "Stage8ExceptionType" NOT NULL,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    "status" "Stage8ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "assignedToUserId" UUID,
    "resolvedByUserId" UUID,
    "resolution" VARCHAR(1000),
    "resolvedAt" TIMESTAMP(3),
    "resolvedResultId" UUID,
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributionException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTimelineEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderEventId" UUID,
    "attributionResultId" UUID,
    "exceptionId" UUID,
    "eventType" "Stage8TimelineEventType" NOT NULL,
    "eventKey" VARCHAR(240) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage8OutboxEvent" (
    "id" UUID NOT NULL,
    "eventKey" VARCHAR(240) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "aggregateType" VARCHAR(80) NOT NULL,
    "aggregateId" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "Stage8OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(120),
    "lastErrorMessage" VARCHAR(500),
    "requestId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage8OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackerInstallation_publicKey_key" ON "TrackerInstallation"("publicKey");

-- CreateIndex
CREATE INDEX "TrackerInstallation_brandId_status_idx" ON "TrackerInstallation"("brandId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerInstallation_brandId_primaryDomain_key" ON "TrackerInstallation"("brandId", "primaryDomain");

-- CreateIndex
CREATE UNIQUE INDEX "TildaIntegration_trackerInstallationId_key" ON "TildaIntegration"("trackerInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "TildaIntegration_brandId_key" ON "TildaIntegration"("brandId");

-- CreateIndex
CREATE INDEX "TildaIntegration_status_lastWebhookAt_idx" ON "TildaIntegration"("status", "lastWebhookAt");

-- CreateIndex
CREATE UNIQUE INDEX "TildaPaymentProbe_orderEventId_key" ON "TildaPaymentProbe"("orderEventId");

-- CreateIndex
CREATE UNIQUE INDEX "TildaPaymentProbe_integrationId_externalOrderId_key" ON "TildaPaymentProbe"("integrationId", "externalOrderId");

-- CreateIndex
CREATE INDEX "TildaPaymentProbe_status_nextAttemptAt_idx" ON "TildaPaymentProbe"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredentialVersion_keyId_key" ON "IntegrationCredentialVersion"("keyId");

-- CreateIndex
CREATE INDEX "IntegrationCredentialVersion_installationId_status_validFro_idx" ON "IntegrationCredentialVersion"("installationId", "status", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredentialVersion_installationId_version_key" ON "IntegrationCredentialVersion"("installationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorLink_code_key" ON "CreatorLink"("code");

-- CreateIndex
CREATE INDEX "CreatorLink_brandId_status_activeFrom_idx" ON "CreatorLink"("brandId", "status", "activeFrom");

-- CreateIndex
CREATE INDEX "CreatorLink_affiliateRelationshipId_status_idx" ON "CreatorLink"("affiliateRelationshipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPromoCode_normalizedCode_key" ON "CreatorPromoCode"("normalizedCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPromoCode_replacementForId_key" ON "CreatorPromoCode"("replacementForId");

-- CreateIndex
CREATE INDEX "CreatorPromoCode_brandId_normalizedCode_status_idx" ON "CreatorPromoCode"("brandId", "normalizedCode", "status");

-- CreateIndex
CREATE INDEX "CreatorPromoCode_affiliateRelationshipId_status_idx" ON "CreatorPromoCode"("affiliateRelationshipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClickSession_publicAttributionId_key" ON "ClickSession"("publicAttributionId");

-- CreateIndex
CREATE INDEX "ClickSession_trackerInstallationId_lastSeenAt_idx" ON "ClickSession"("trackerInstallationId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ClickSession_affiliateRelationshipId_firstClickedAt_idx" ON "ClickSession"("affiliateRelationshipId", "firstClickedAt");

-- CreateIndex
CREATE INDEX "ClickSession_expiresAt_status_idx" ON "ClickSession"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "TrackingEvent_trackerInstallationId_occurredAt_idx" ON "TrackingEvent"("trackerInstallationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_trackerInstallationId_externalEventId_key" ON "TrackingEvent"("trackerInstallationId", "externalEventId");

-- CreateIndex
CREATE INDEX "AttributionRuleSet_brandId_offerId_status_effectiveFrom_idx" ON "AttributionRuleSet"("brandId", "offerId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionRuleSet_brandId_offerId_version_key" ON "AttributionRuleSet"("brandId", "offerId", "version");

-- CreateIndex
CREATE INDEX "Stage8OrderEvent_brandId_canonicalOrderKey_occurredAt_idx" ON "Stage8OrderEvent"("brandId", "canonicalOrderKey", "occurredAt");

-- CreateIndex
CREATE INDEX "Stage8OrderEvent_processingStatus_nextAttemptAt_idx" ON "Stage8OrderEvent"("processingStatus", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Stage8OrderEvent_brandId_sourceNamespace_externalEventId_key" ON "Stage8OrderEvent"("brandId", "sourceNamespace", "externalEventId");

-- CreateIndex
CREATE INDEX "AttributionEvidence_orderId_validationStatus_idx" ON "AttributionEvidence"("orderId", "validationStatus");

-- CreateIndex
CREATE INDEX "AttributionEvidence_orderEventId_idx" ON "AttributionEvidence"("orderEventId");

-- CreateIndex
CREATE INDEX "AttributionEvidence_identifierHash_idx" ON "AttributionEvidence"("identifierHash");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionResult_supersedesResultId_key" ON "AttributionResult"("supersedesResultId");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionResult_decisionHash_key" ON "AttributionResult"("decisionHash");

-- CreateIndex
CREATE INDEX "AttributionResult_status_createdAt_idx" ON "AttributionResult"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionResult_affiliateCommercialAgreementId_attributed_idx" ON "AttributionResult"("affiliateCommercialAgreementId", "attributedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionResult_orderId_decisionVersion_key" ON "AttributionResult"("orderId", "decisionVersion");

-- CreateIndex
CREATE INDEX "AttributionException_brandId_status_dueAt_idx" ON "AttributionException"("brandId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "AttributionException_status_escalatedAt_dueAt_idx" ON "AttributionException"("status", "escalatedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTimelineEvent_eventKey_key" ON "OrderTimelineEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OrderTimelineEvent_orderId_occurredAt_idx" ON "OrderTimelineEvent"("orderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Stage8OutboxEvent_eventKey_key" ON "Stage8OutboxEvent"("eventKey");

-- CreateIndex
CREATE INDEX "Stage8OutboxEvent_status_nextAttemptAt_createdAt_idx" ON "Stage8OutboxEvent"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_currentAttributionResultId_key" ON "Order"("currentAttributionResultId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_brandId_canonicalOrderKey_key" ON "Order"("brandId", "canonicalOrderKey");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_currentAttributionResultId_fkey" FOREIGN KEY ("currentAttributionResultId") REFERENCES "AttributionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerInstallation" ADD CONSTRAINT "TrackerInstallation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerInstallation" ADD CONSTRAINT "TrackerInstallation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TildaIntegration" ADD CONSTRAINT "TildaIntegration_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TildaIntegration" ADD CONSTRAINT "TildaIntegration_trackerInstallationId_fkey" FOREIGN KEY ("trackerInstallationId") REFERENCES "TrackerInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TildaIntegration" ADD CONSTRAINT "TildaIntegration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TildaPaymentProbe" ADD CONSTRAINT "TildaPaymentProbe_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "TildaIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TildaPaymentProbe" ADD CONSTRAINT "TildaPaymentProbe_orderEventId_fkey" FOREIGN KEY ("orderEventId") REFERENCES "Stage8OrderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredentialVersion" ADD CONSTRAINT "IntegrationCredentialVersion_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "TrackerInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPromoCode" ADD CONSTRAINT "CreatorPromoCode_replacementForId_fkey" FOREIGN KEY ("replacementForId") REFERENCES "CreatorPromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_trackerInstallationId_fkey" FOREIGN KEY ("trackerInstallationId") REFERENCES "TrackerInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_creatorLinkId_fkey" FOREIGN KEY ("creatorLinkId") REFERENCES "CreatorLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_creatorPromoCodeId_fkey" FOREIGN KEY ("creatorPromoCodeId") REFERENCES "CreatorPromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickSession" ADD CONSTRAINT "ClickSession_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_trackerInstallationId_fkey" FOREIGN KEY ("trackerInstallationId") REFERENCES "TrackerInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_clickSessionId_fkey" FOREIGN KEY ("clickSessionId") REFERENCES "ClickSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionRuleSet" ADD CONSTRAINT "AttributionRuleSet_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionRuleSet" ADD CONSTRAINT "AttributionRuleSet_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionRuleSet" ADD CONSTRAINT "AttributionRuleSet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage8OrderEvent" ADD CONSTRAINT "Stage8OrderEvent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage8OrderEvent" ADD CONSTRAINT "Stage8OrderEvent_trackerInstallationId_fkey" FOREIGN KEY ("trackerInstallationId") REFERENCES "TrackerInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage8OrderEvent" ADD CONSTRAINT "Stage8OrderEvent_orderImportId_fkey" FOREIGN KEY ("orderImportId") REFERENCES "OrderImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage8OrderEvent" ADD CONSTRAINT "Stage8OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_orderEventId_fkey" FOREIGN KEY ("orderEventId") REFERENCES "Stage8OrderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_clickSessionId_fkey" FOREIGN KEY ("clickSessionId") REFERENCES "ClickSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvidence" ADD CONSTRAINT "AttributionEvidence_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_affiliateRelationshipId_fkey" FOREIGN KEY ("affiliateRelationshipId") REFERENCES "AffiliateRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_affiliateCommercialAgreementId_fkey" FOREIGN KEY ("affiliateCommercialAgreementId") REFERENCES "AffiliateCommercialAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "AttributionRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_supersedesResultId_fkey" FOREIGN KEY ("supersedesResultId") REFERENCES "AttributionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_attributionResultId_fkey" FOREIGN KEY ("attributionResultId") REFERENCES "AttributionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_resolvedResultId_fkey" FOREIGN KEY ("resolvedResultId") REFERENCES "AttributionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionException" ADD CONSTRAINT "AttributionException_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTimelineEvent" ADD CONSTRAINT "OrderTimelineEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTimelineEvent" ADD CONSTRAINT "OrderTimelineEvent_orderEventId_fkey" FOREIGN KEY ("orderEventId") REFERENCES "Stage8OrderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTimelineEvent" ADD CONSTRAINT "OrderTimelineEvent_attributionResultId_fkey" FOREIGN KEY ("attributionResultId") REFERENCES "AttributionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTimelineEvent" ADD CONSTRAINT "OrderTimelineEvent_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "AttributionException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill the approved pilot attribution policy once per existing Brand.
INSERT INTO "AttributionRuleSet" (
  "id",
  "brandId",
  "offerId",
  "version",
  "status",
  "sourcePriority",
  "attributionWindowDays",
  "attributionModel",
  "crossCreatorConflictPolicy",
  "cookieTtlDays",
  "rules",
  "contentHash",
  "effectiveFrom",
  "createdByUserId",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  brand."id",
  NULL,
  1,
  'ACTIVE'::"Stage8IntegrationStatus",
  ARRAY[
    'CREATOR_LINK'::"Stage8OrderSource",
    'CREATOR_PROMO_CODE'::"Stage8OrderSource",
    'WEBSITE_TRACKER'::"Stage8OrderSource",
    'CSV_IMPORT'::"Stage8OrderSource"
  ],
  30,
  'LAST_ELIGIBLE_TOUCH',
  'REVIEW_REQUIRED',
  30,
  jsonb_build_object(
    'attributionWindowDays', 30,
    'attributionModel', 'LAST_ELIGIBLE_TOUCH',
    'cookieTtlDays', 30,
    'crossCreatorConflictPolicy', 'REVIEW_REQUIRED',
    'webhookTimestampToleranceSeconds', 300,
    'webhookRetryHours', 72,
    'exceptionSlaBusinessDays', 3,
    'csvFallbackSchedule', jsonb_build_array(
      jsonb_build_object('weekday', 'TUESDAY', 'localTime', '18:00'),
      jsonb_build_object('weekday', 'FRIDAY', 'localTime', '18:00')
    ),
    'csvFallbackTimezone', brand."timezone",
    'chargebackPolicy', 'DISPUTE_THEN_FINAL_REVERSAL',
    'trackingRetentionMonths', 13,
    'orderPayloadRetentionMonths', 24
  ),
  repeat(md5(brand."id"::text || ':stage8-pilot-policy-v1'), 2),
  CURRENT_TIMESTAMP,
  brand."userId",
  CURRENT_TIMESTAMP
FROM "BrandProfile" brand
ON CONFLICT ("brandId", "offerId", "version") DO NOTHING;

-- Preserve existing creator links and promo codes as immutable Stage 8 identifiers.
INSERT INTO "CreatorLink" (
  "id",
  "brandId",
  "offerId",
  "creatorId",
  "affiliateRelationshipId",
  "affiliateCommercialAgreementId",
  "code",
  "destinationUrl",
  "status",
  "activeFrom",
  "activeUntil",
  "revokedAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  offer."brandId",
  relationship."offerId",
  relationship."creatorId",
  relationship."id",
  agreement."id",
  relationship."affiliateCode",
  relationship."destinationUrl",
  CASE relationship."status"::text
    WHEN 'ACTIVE' THEN 'ACTIVE'::"Stage8IntegrationStatus"
    WHEN 'PAUSED' THEN 'PAUSED'::"Stage8IntegrationStatus"
    ELSE 'REVOKED'::"Stage8IntegrationStatus"
  END,
  relationship."activatedAt",
  relationship."revokedAt",
  relationship."revokedAt",
  relationship."createdAt"
FROM "AffiliateRelationship" relationship
JOIN "Offer" offer ON offer."id" = relationship."offerId"
LEFT JOIN "AffiliateCommercialAgreement" agreement
  ON agreement."affiliateRelationshipId" = relationship."id"
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliateRelationship"
    GROUP BY upper(normalize(trim("promoCode"), NFKC))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Stage 8 migration blocked: normalized legacy promo-code collision';
  END IF;
END;
$$;

INSERT INTO "CreatorPromoCode" (
  "id",
  "brandId",
  "offerId",
  "creatorId",
  "affiliateRelationshipId",
  "affiliateCommercialAgreementId",
  "rawCode",
  "normalizedCode",
  "normalizationPolicy",
  "discountType",
  "discountBps",
  "discountAmountMinor",
  "currency",
  "status",
  "activeFrom",
  "activeUntil",
  "revokedAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  offer."brandId",
  relationship."offerId",
  relationship."creatorId",
  relationship."id",
  agreement."id",
  relationship."promoCode",
  upper(normalize(trim(relationship."promoCode"), NFKC)),
  'NFKC_TRIM_UPPER_V1',
  'NONE',
  NULL,
  NULL,
  COALESCE(agreement."currency", 'RUB'),
  CASE relationship."status"::text
    WHEN 'ACTIVE' THEN 'ACTIVE'::"CreatorPromoCodeStatus"
    WHEN 'PAUSED' THEN 'ACTIVE'::"CreatorPromoCodeStatus"
    ELSE 'REVOKED'::"CreatorPromoCodeStatus"
  END,
  relationship."activatedAt",
  relationship."revokedAt",
  relationship."revokedAt",
  relationship."createdAt"
FROM "AffiliateRelationship" relationship
JOIN "Offer" offer ON offer."id" = relationship."offerId"
LEFT JOIN "AffiliateCommercialAgreement" agreement
  ON agreement."affiliateRelationshipId" = relationship."id"
ON CONFLICT ("normalizedCode") DO NOTHING;

CREATE FUNCTION "protect_creator_promo_code_identity"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_creator_promo_code_cleanup', true) = 'on'
    AND current_database() LIKE '%\_test' ESCAPE '\'
  THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CreatorPromoCode records are permanent';
  END IF;

  IF NEW."normalizedCode" IS DISTINCT FROM OLD."normalizedCode"
    OR NEW."rawCode" IS DISTINCT FROM OLD."rawCode"
    OR NEW."normalizationPolicy" IS DISTINCT FROM OLD."normalizationPolicy"
    OR NEW."creatorId" IS DISTINCT FROM OLD."creatorId"
    OR NEW."affiliateRelationshipId" IS DISTINCT FROM OLD."affiliateRelationshipId"
    OR NEW."affiliateCommercialAgreementId" IS DISTINCT FROM OLD."affiliateCommercialAgreementId"
    OR NEW."brandId" IS DISTINCT FROM OLD."brandId"
    OR NEW."offerId" IS DISTINCT FROM OLD."offerId"
    OR NEW."discountType" IS DISTINCT FROM OLD."discountType"
    OR NEW."discountBps" IS DISTINCT FROM OLD."discountBps"
    OR NEW."discountAmountMinor" IS DISTINCT FROM OLD."discountAmountMinor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."replacementForId" IS DISTINCT FROM OLD."replacementForId"
  THEN
    RAISE EXCEPTION 'CreatorPromoCode identity and ownership are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CreatorPromoCode_identity_immutable"
BEFORE UPDATE OR DELETE ON "CreatorPromoCode"
FOR EACH ROW EXECUTE FUNCTION "protect_creator_promo_code_identity"();

CREATE FUNCTION "protect_affiliate_relationship_promo_pointer"()
RETURNS trigger AS $$
BEGIN
  IF NEW."promoCode" IS NOT DISTINCT FROM OLD."promoCode" THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "CreatorPromoCode" promo
    JOIN "Offer" offer ON offer."id" = NEW."offerId"
    WHERE promo."normalizedCode" = upper(normalize(trim(NEW."promoCode"), NFKC))
      AND promo."creatorId" = NEW."creatorId"
      AND promo."affiliateRelationshipId" = NEW."id"
      AND promo."brandId" = offer."brandId"
      AND promo."offerId" = NEW."offerId"
  ) THEN
    RAISE EXCEPTION 'AffiliateRelationship promoCode must reference its immutable CreatorPromoCode owner';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AffiliateRelationship_promo_pointer_owner"
BEFORE UPDATE OF "promoCode", "creatorId", "offerId" ON "AffiliateRelationship"
FOR EACH ROW EXECUTE FUNCTION "protect_affiliate_relationship_promo_pointer"();

-- Backfill redirect clicks as legacy evidence without fabricating tracker installations.
INSERT INTO "ClickSession" (
  "id",
  "publicAttributionId",
  "creatorLinkId",
  "clickId",
  "affiliateRelationshipId",
  "affiliateCommercialAgreementId",
  "creatorId",
  "offerId",
  "firstClickedAt",
  "lastSeenAt",
  "expiresAt",
  "landingUrl",
  "ipHash",
  "userAgentHash",
  "consentState",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'legacy_click_' || replace(click."id"::text, '-', ''),
  link."id",
  click."id",
  click."affiliateRelationshipId",
  agreement."id",
  click."creatorId",
  click."offerId",
  click."clickedAt",
  click."clickedAt",
  click."clickedAt" + make_interval(
    days => LEAST(
      30,
      GREATEST(
        1,
        COALESCE(
          NULLIF(agreement."attributionWindowSnapshot"->>'windowDays', '')::integer,
          30
        )
      )
    )
  ),
  click."landingUrl",
  click."ipHash",
  CASE
    WHEN click."userAgent" IS NULL THEN NULL
    ELSE repeat(md5(click."userAgent"), 2)
  END,
  'UNKNOWN',
  'ACTIVE'::"Stage8IntegrationStatus",
  click."createdAt",
  click."createdAt"
FROM "Click" click
LEFT JOIN "AffiliateCommercialAgreement" agreement
  ON agreement."affiliateRelationshipId" = click."affiliateRelationshipId"
LEFT JOIN "CreatorLink" link ON link."code" = click."affiliateCode"
ON CONFLICT ("publicAttributionId") DO NOTHING;

-- Create immutable synthetic source events for historical Orders.
INSERT INTO "Stage8OrderEvent" (
  "id",
  "brandId",
  "orderImportId",
  "orderId",
  "source",
  "sourceNamespace",
  "externalEventId",
  "externalOrderId",
  "canonicalOrderKey",
  "eventType",
  "occurredAt",
  "receivedAt",
  "orderCreatedAt",
  "amountMinor",
  "refundAmountMinor",
  "currency",
  "offerIdHint",
  "clickIdHint",
  "creatorLinkCode",
  "promoCode",
  "schemaVersion",
  "payload",
  "payloadHash",
  "authenticationContext",
  "requestId",
  "processingStatus",
  "attemptCount",
  "processedAt",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  orders."brandId",
  orders."orderImportId",
  orders."id",
  'LEGACY_BACKFILL'::"Stage8OrderSource",
  'LEGACY_CSV',
  'legacy-order-' || orders."id"::text,
  orders."externalOrderId",
  orders."externalOrderId",
  CASE orders."status"::text
    WHEN 'PAID' THEN 'PAYMENT_SUCCEEDED'::"Stage8OrderEventType"
    WHEN 'CANCELLED' THEN 'ORDER_CANCELLED'::"Stage8OrderEventType"
    WHEN 'RETURNED' THEN 'REFUND_SUCCEEDED'::"Stage8OrderEventType"
    WHEN 'PARTIALLY_RETURNED' THEN 'PARTIAL_REFUND_SUCCEEDED'::"Stage8OrderEventType"
    ELSE 'ORDER_CREATED'::"Stage8OrderEventType"
  END,
  orders."orderDate",
  orders."importedAt",
  orders."orderDate",
  COALESCE(orders."amountMinor", orders."amountKopecks"::bigint),
  CASE
    WHEN orders."returnedAmountKopecks" > 0
      THEN COALESCE(orders."returnedAmountMinor", orders."returnedAmountKopecks"::bigint)
    ELSE NULL
  END,
  orders."currency",
  orders."offerId",
  orders."clickId"::text,
  orders."affiliateCode",
  orders."promoCode",
  '1.0',
  jsonb_build_object(
    'legacyBackfill', true,
    'externalOrderId', orders."externalOrderId",
    'status', orders."status"::text
  ),
  repeat(md5(orders."id"::text || ':legacy-order-event'), 2),
  jsonb_build_object('source', 'LEGACY_BACKFILL', 'authenticated', true),
  'stage8-backfill-' || orders."id"::text,
  'PROCESSED'::"Stage8EventProcessingStatus",
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Order" orders
ON CONFLICT ("brandId", "sourceNamespace", "externalEventId") DO NOTHING;

-- Preserve historical attribution decisions exactly as stored on Order.
INSERT INTO "AttributionResult" (
  "id",
  "orderId",
  "decisionVersion",
  "status",
  "creatorId",
  "offerId",
  "affiliateRelationshipId",
  "affiliateCommercialAgreementId",
  "ruleSetId",
  "ruleSetVersion",
  "confidenceLevel",
  "confidenceScore",
  "reasonCodes",
  "evidenceIds",
  "attributedAt",
  "decidedByType",
  "decisionHash",
  "requestId",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  orders."id",
  1,
  CASE
    WHEN orders."affiliateRelationshipId" IS NULL
      THEN 'UNATTRIBUTED'::"Stage8AttributionStatus"
    ELSE 'AUTO_ATTRIBUTED'::"Stage8AttributionStatus"
  END,
  relationship."creatorId",
  orders."offerId",
  orders."affiliateRelationshipId",
  orders."affiliateCommercialAgreementId",
  rules."id",
  rules."version",
  CASE
    WHEN orders."affiliateRelationshipId" IS NULL
      THEN 'NONE'::"Stage8ConfidenceLevel"
    ELSE 'VERIFIED'::"Stage8ConfidenceLevel"
  END,
  CASE WHEN orders."affiliateRelationshipId" IS NULL THEN 0 ELSE 100 END,
  ARRAY['LEGACY_BACKFILL_PRESERVED'],
  ARRAY[]::text[],
  orders."attributedAt",
  'LEGACY_BACKFILL',
  repeat(md5(orders."id"::text || ':legacy-attribution-result'), 2),
  'stage8-backfill-' || orders."id"::text,
  CURRENT_TIMESTAMP
FROM "Order" orders
LEFT JOIN "AffiliateRelationship" relationship
  ON relationship."id" = orders."affiliateRelationshipId"
LEFT JOIN LATERAL (
  SELECT rule."id", rule."version"
  FROM "AttributionRuleSet" rule
  WHERE rule."brandId" = orders."brandId" AND rule."offerId" IS NULL
  ORDER BY rule."version" DESC
  LIMIT 1
) rules ON true
ON CONFLICT ("orderId", "decisionVersion") DO NOTHING;

UPDATE "Order" orders
SET
  "canonicalOrderKey" = orders."externalOrderId",
  "sourceNamespace" = 'LEGACY_CSV',
  "stage8Source" = 'LEGACY_BACKFILL'::"Stage8OrderSource",
  "commerceStatus" = CASE orders."status"::text
    WHEN 'PAID' THEN 'PAID'::"Stage8CommerceOrderStatus"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"Stage8CommerceOrderStatus"
    WHEN 'RETURNED' THEN 'REFUNDED'::"Stage8CommerceOrderStatus"
    WHEN 'PARTIALLY_RETURNED' THEN 'PARTIALLY_REFUNDED'::"Stage8CommerceOrderStatus"
    ELSE 'PENDING_PAYMENT'::"Stage8CommerceOrderStatus"
  END,
  "currentAttributionResultId" = result."id",
  "financialHandoffStatus" = CASE
    WHEN commission."id" IS NOT NULL
      THEN 'ACKNOWLEDGED'::"Stage8FinancialHandoffStatus"
    ELSE 'NOT_READY'::"Stage8FinancialHandoffStatus"
  END,
  "paidAt" = CASE
    WHEN orders."status"::text IN ('PAID', 'RETURNED', 'PARTIALLY_RETURNED')
      THEN COALESCE(orders."confirmedAt", orders."orderDate")
    ELSE NULL
  END,
  "cancelledAt" = CASE
    WHEN orders."status"::text = 'CANCELLED' THEN orders."updatedAt"
    ELSE NULL
  END
FROM "AttributionResult" result
LEFT JOIN "Commission" commission ON commission."orderId" = result."orderId"
WHERE result."orderId" = orders."id" AND result."decisionVersion" = 1;

INSERT INTO "OrderTimelineEvent" (
  "id",
  "orderId",
  "orderEventId",
  "attributionResultId",
  "eventType",
  "eventKey",
  "occurredAt",
  "summary",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  event."orderId",
  event."id",
  result."id",
  'ATTRIBUTION_COMPLETED'::"Stage8TimelineEventType",
  'stage8:legacy-order:' || event."orderId"::text,
  event."occurredAt",
  jsonb_build_object(
    'source', 'LEGACY_BACKFILL',
    'attributionStatus', result."status"::text,
    'financialHistoryReprocessed', false
  ),
  CURRENT_TIMESTAMP
FROM "Stage8OrderEvent" event
JOIN "AttributionResult" result
  ON result."orderId" = event."orderId" AND result."decisionVersion" = 1
WHERE event."source" = 'LEGACY_BACKFILL'::"Stage8OrderSource"
ON CONFLICT ("eventKey") DO NOTHING;
