CREATE TYPE "BrandVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

ALTER TABLE "BrandProfile"
ADD COLUMN "verificationStatus" "BrandVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedByUserId" UUID;

CREATE INDEX "BrandProfile_verificationStatus_createdAt_idx"
ON "BrandProfile"("verificationStatus", "createdAt");

CREATE INDEX "BrandProfile_verifiedByUserId_idx"
ON "BrandProfile"("verifiedByUserId");

ALTER TABLE "BrandProfile"
ADD CONSTRAINT "BrandProfile_verifiedByUserId_fkey"
FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
