CREATE TYPE "UserRole" AS ENUM ('BRAND', 'CREATOR', 'ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE "PromotionWithoutProduct" AS ENUM ('YES', 'NO', 'LIMITED');
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'MODERATION', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email")),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrandProfile" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "brandName" VARCHAR(160) NOT NULL,
  "legalName" VARCHAR(240),
  "website" VARCHAR(500),
  "description" TEXT,
  "logoUrl" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorProfile" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "socialLinks" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Offer" (
  "id" UUID NOT NULL,
  "brandId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "productUrl" VARCHAR(1000),
  "productPriceKopecks" INTEGER NOT NULL,
  "creatorCommissionBps" INTEGER NOT NULL,
  "platformCommissionBps" INTEGER NOT NULL,
  "promotionWithoutProduct" "PromotionWithoutProduct" NOT NULL,
  "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
  "category" VARCHAR(120),
  "imageUrl" VARCHAR(1000),
  "productRequirementSales" INTEGER NOT NULL DEFAULT 0,
  "allowedPromotionFormats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Offer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Offer_productPriceKopecks_check" CHECK ("productPriceKopecks" >= 0),
  CONSTRAINT "Offer_creatorCommissionBps_check" CHECK ("creatorCommissionBps" BETWEEN 0 AND 10000),
  CONSTRAINT "Offer_platformCommissionBps_check" CHECK ("platformCommissionBps" BETWEEN 0 AND 10000),
  CONSTRAINT "Offer_productRequirementSales_check" CHECK ("productRequirementSales" >= 0)
);

CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "userAgent" VARCHAR(500),
  "ipAddress" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE UNIQUE INDEX "BrandProfile_userId_key" ON "BrandProfile"("userId");
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");
CREATE INDEX "Offer_brandId_status_idx" ON "Offer"("brandId", "status");
CREATE INDEX "Offer_status_createdAt_idx" ON "Offer"("status", "createdAt");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

ALTER TABLE "BrandProfile"
  ADD CONSTRAINT "BrandProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorProfile"
  ADD CONSTRAINT "CreatorProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "BrandProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
