CREATE TYPE "CreatorKitRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "CreatorProductAccessStatus" AS ENUM ('ACTIVE', 'REVOKED');

ALTER TABLE "CreatorKit"
  ADD COLUMN "activeRevisionId" UUID,
  ADD COLUMN "draftRevisionId" UUID;

ALTER TABLE "CreatorKitScenario"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "hook" TEXT,
  ADD COLUMN "structure" TEXT,
  ADD COLUMN "cta" TEXT;

ALTER TABLE "CreatorKitFact"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CreatorKitClaim"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CreatorKitRule"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PublicationRequirements"
  ADD COLUMN "revisionId" UUID,
  ADD COLUMN "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  ADD COLUMN "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CreatorKitRevision" (
  "id" UUID NOT NULL,
  "creatorKitId" UUID NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "status" "CreatorKitRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "basedOnRevisionId" UUID,
  "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshot" JSONB,
  "changeSummary" VARCHAR(1000),
  "changeSet" JSONB,
  "publisherNote" VARCHAR(1000),
  "completenessPercent" INTEGER NOT NULL DEFAULT 0,
  "completenessDetails" JSONB,
  "createdByUserId" UUID NOT NULL,
  "publishedByUserId" UUID,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreatorKitRevision_completenessPercent_check"
    CHECK ("completenessPercent" BETWEEN 0 AND 100)
);

CREATE TABLE "CreatorKitBrandContent" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "description" TEXT,
  "history" TEXT,
  "values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "positioning" TEXT,
  "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitBrandContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitProductContent" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "description" TEXT,
  "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "usageInstructions" TEXT,
  "accessLevel" "CreatorKitAccessLevel" NOT NULL DEFAULT 'DIGITAL',
  "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitProductContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorKitRevisionAsset" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "accessLevel" "CreatorKitAccessLevel" NOT NULL,
  "requiresAffiliateApproval" BOOLEAN NOT NULL DEFAULT false,
  "editable" BOOLEAN NOT NULL DEFAULT false,
  "textAllowed" BOOLEAN NOT NULL DEFAULT false,
  "paidAdsAllowed" BOOLEAN NOT NULL DEFAULT false,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorKitRevisionAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorProductAccessGrant" (
  "id" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "status" "CreatorProductAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedByUserId" UUID NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedByUserId" UUID,
  "revokedAt" TIMESTAMP(3),
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorProductAccessGrant_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CreatorKitRevision"
  ADD CONSTRAINT "CreatorKitRevision_creatorKitId_fkey"
  FOREIGN KEY ("creatorKitId") REFERENCES "CreatorKit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorKitRevision_basedOnRevisionId_fkey"
  FOREIGN KEY ("basedOnRevisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorKitRevision_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorKitRevision_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitBrandContent"
  ADD CONSTRAINT "CreatorKitBrandContent_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitProductContent"
  ADD CONSTRAINT "CreatorKitProductContent_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitRevisionAsset"
  ADD CONSTRAINT "CreatorKitRevisionAsset_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorKitRevisionAsset_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "CreatorKitAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorProductAccessGrant"
  ADD CONSTRAINT "CreatorProductAccessGrant_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorProductAccessGrant_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorProductAccessGrant_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorProductAccessGrant_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CreatorKitRevision" (
  "id",
  "creatorKitId",
  "revisionNumber",
  "status",
  "snapshotSchemaVersion",
  "changeSummary",
  "changeSet",
  "createdByUserId",
  "publishedByUserId",
  "publishedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  ck."id",
  1,
  'PUBLISHED'::"CreatorKitRevisionStatus",
  1,
  'Initial Creator Kit migrated to revision history',
  '{"schemaVersion":1,"sections":[{"section":"MIGRATION","changeType":"CREATED"}]}'::jsonb,
  bp."userId",
  bp."userId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CreatorKit" ck
JOIN "Offer" o ON o."id" = ck."offerId"
JOIN "BrandProfile" bp ON bp."id" = o."brandId";

UPDATE "CreatorKitScenario" item
SET "revisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = item."creatorKitId"
  AND revision."revisionNumber" = 1;

UPDATE "CreatorKitFact" item
SET "revisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = item."creatorKitId"
  AND revision."revisionNumber" = 1;

UPDATE "CreatorKitClaim" item
SET "revisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = item."creatorKitId"
  AND revision."revisionNumber" = 1;

UPDATE "CreatorKitRule" item
SET "revisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = item."creatorKitId"
  AND revision."revisionNumber" = 1;

UPDATE "PublicationRequirements" item
SET "revisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = item."creatorKitId"
  AND revision."revisionNumber" = 1;

INSERT INTO "CreatorKitBrandContent" (
  "id",
  "revisionId",
  "description",
  "history",
  "values",
  "positioning",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  revision."id",
  bp."description",
  NULL,
  ARRAY[]::TEXT[],
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CreatorKitRevision" revision
JOIN "CreatorKit" ck ON ck."id" = revision."creatorKitId"
JOIN "Offer" o ON o."id" = ck."offerId"
JOIN "BrandProfile" bp ON bp."id" = o."brandId"
WHERE revision."revisionNumber" = 1;

INSERT INTO "CreatorKitProductContent" (
  "id",
  "revisionId",
  "description",
  "benefits",
  "usageInstructions",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  revision."id",
  o."description",
  ARRAY[]::TEXT[],
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CreatorKitRevision" revision
JOIN "CreatorKit" ck ON ck."id" = revision."creatorKitId"
JOIN "Offer" o ON o."id" = ck."offerId"
WHERE revision."revisionNumber" = 1;

INSERT INTO "CreatorKitRevisionAsset" (
  "id",
  "revisionId",
  "assetId",
  "title",
  "accessLevel",
  "requiresAffiliateApproval",
  "editable",
  "textAllowed",
  "paidAdsAllowed",
  "approvalRequired",
  "expiresAt",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  revision."id",
  asset."id",
  asset."title",
  asset."accessLevel",
  asset."requiresAffiliateApproval",
  asset."editable",
  asset."textAllowed",
  asset."paidAdsAllowed",
  asset."approvalRequired",
  asset."expiresAt",
  ROW_NUMBER() OVER (
    PARTITION BY revision."id"
    ORDER BY asset."createdAt", asset."id"
  ) - 1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CreatorKitAsset" asset
JOIN "CreatorKitRevision" revision ON revision."creatorKitId" = asset."creatorKitId"
WHERE revision."revisionNumber" = 1;

UPDATE "CreatorKit" ck
SET "activeRevisionId" = revision."id"
FROM "CreatorKitRevision" revision
WHERE revision."creatorKitId" = ck."id"
  AND revision."revisionNumber" = 1;

UPDATE "CreatorKitRevision" revision
SET "snapshot" = jsonb_build_object(
  'schemaVersion', 1,
  'customSections', '[]'::jsonb,
  'brandContent', (
    SELECT to_jsonb(content) - 'id' - 'revisionId' - 'createdAt' - 'updatedAt'
    FROM "CreatorKitBrandContent" content
    WHERE content."revisionId" = revision."id"
  ),
  'productContent', (
    SELECT to_jsonb(content) - 'id' - 'revisionId' - 'createdAt' - 'updatedAt'
    FROM "CreatorKitProductContent" content
    WHERE content."revisionId" = revision."id"
  ),
  'assets', COALESCE((
    SELECT jsonb_agg(
      (to_jsonb(link) - 'id' - 'revisionId' - 'createdAt' - 'updatedAt')
      || jsonb_build_object(
        'assetType', asset."assetType",
        'status', asset."status",
        'originalFileName', asset."originalFileName",
        'extension', asset."extension",
        'mimeType', asset."mimeType",
        'byteSize', asset."byteSize"
      )
      ORDER BY link."sortOrder", link."id"
    )
    FROM "CreatorKitRevisionAsset" link
    JOIN "CreatorKitAsset" asset ON asset."id" = link."assetId"
    WHERE link."revisionId" = revision."id"
  ), '[]'::jsonb),
  'scenarios', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(item) - 'revisionId' - 'createdAt' - 'updatedAt'
      ORDER BY item."sortOrder", item."id"
    )
    FROM "CreatorKitScenario" item
    WHERE item."revisionId" = revision."id"
  ), '[]'::jsonb),
  'facts', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(item) - 'revisionId' - 'createdAt' - 'updatedAt'
      ORDER BY item."sortOrder", item."id"
    )
    FROM "CreatorKitFact" item
    WHERE item."revisionId" = revision."id"
  ), '[]'::jsonb),
  'claims', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(item) - 'revisionId' - 'createdAt' - 'updatedAt'
      ORDER BY item."sortOrder", item."id"
    )
    FROM "CreatorKitClaim" item
    WHERE item."revisionId" = revision."id"
  ), '[]'::jsonb),
  'rules', COALESCE((
    SELECT jsonb_agg(
      to_jsonb(item) - 'revisionId' - 'createdAt' - 'updatedAt'
      ORDER BY item."sortOrder", item."id"
    )
    FROM "CreatorKitRule" item
    WHERE item."revisionId" = revision."id"
  ), '[]'::jsonb),
  'publicationRequirements', (
    SELECT to_jsonb(item) - 'id' - 'revisionId' - 'createdAt' - 'updatedAt'
    FROM "PublicationRequirements" item
    WHERE item."revisionId" = revision."id"
  )
)
WHERE revision."revisionNumber" = 1;

ALTER TABLE "CreatorKitScenario" ALTER COLUMN "revisionId" SET NOT NULL;
ALTER TABLE "CreatorKitFact" ALTER COLUMN "revisionId" SET NOT NULL;
ALTER TABLE "CreatorKitClaim" ALTER COLUMN "revisionId" SET NOT NULL;
ALTER TABLE "CreatorKitRule" ALTER COLUMN "revisionId" SET NOT NULL;
ALTER TABLE "PublicationRequirements" ALTER COLUMN "revisionId" SET NOT NULL;

-- Keep the legacy CreatorKit foreign keys and indexes during Stage 6.5.
-- New revision rows leave creatorKitId NULL, while the migrated v1 rows retain
-- their original values. This keeps an application-only rollback possible.
ALTER TABLE "CreatorKitScenario" ALTER COLUMN "creatorKitId" DROP NOT NULL;
ALTER TABLE "CreatorKitFact" ALTER COLUMN "creatorKitId" DROP NOT NULL;
ALTER TABLE "CreatorKitClaim" ALTER COLUMN "creatorKitId" DROP NOT NULL;
ALTER TABLE "CreatorKitRule" ALTER COLUMN "creatorKitId" DROP NOT NULL;
ALTER TABLE "PublicationRequirements" ALTER COLUMN "creatorKitId" DROP NOT NULL;

CREATE UNIQUE INDEX "CreatorKit_activeRevisionId_key" ON "CreatorKit"("activeRevisionId");
CREATE UNIQUE INDEX "CreatorKit_draftRevisionId_key" ON "CreatorKit"("draftRevisionId");

CREATE UNIQUE INDEX "CreatorKitRevision_creatorKitId_revisionNumber_key"
  ON "CreatorKitRevision"("creatorKitId", "revisionNumber");
CREATE UNIQUE INDEX "CreatorKitRevision_one_draft"
  ON "CreatorKitRevision"("creatorKitId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "CreatorKitRevision_one_published"
  ON "CreatorKitRevision"("creatorKitId") WHERE "status" = 'PUBLISHED';
CREATE INDEX "CreatorKitRevision_creatorKitId_status_idx"
  ON "CreatorKitRevision"("creatorKitId", "status");
CREATE INDEX "CreatorKitRevision_basedOnRevisionId_idx"
  ON "CreatorKitRevision"("basedOnRevisionId");
CREATE INDEX "CreatorKitRevision_publishedAt_idx"
  ON "CreatorKitRevision"("publishedAt");

CREATE UNIQUE INDEX "CreatorKitBrandContent_revisionId_key"
  ON "CreatorKitBrandContent"("revisionId");
CREATE UNIQUE INDEX "CreatorKitProductContent_revisionId_key"
  ON "CreatorKitProductContent"("revisionId");
CREATE UNIQUE INDEX "CreatorKitRevisionAsset_revisionId_assetId_key"
  ON "CreatorKitRevisionAsset"("revisionId", "assetId");
CREATE INDEX "CreatorKitRevisionAsset_revisionId_accessLevel_sortOrder_idx"
  ON "CreatorKitRevisionAsset"("revisionId", "accessLevel", "sortOrder");
CREATE INDEX "CreatorKitRevisionAsset_assetId_idx"
  ON "CreatorKitRevisionAsset"("assetId");

CREATE UNIQUE INDEX "CreatorProductAccessGrant_one_active"
  ON "CreatorProductAccessGrant"("offerId", "creatorId") WHERE "status" = 'ACTIVE';
CREATE INDEX "CreatorProductAccessGrant_offerId_status_idx"
  ON "CreatorProductAccessGrant"("offerId", "status");
CREATE INDEX "CreatorProductAccessGrant_creatorId_status_idx"
  ON "CreatorProductAccessGrant"("creatorId", "status");

CREATE INDEX "CreatorKitScenario_revisionId_accessLevel_sortOrder_idx"
  ON "CreatorKitScenario"("revisionId", "accessLevel", "sortOrder");
CREATE UNIQUE INDEX "CreatorKitFact_revisionId_type_key"
  ON "CreatorKitFact"("revisionId", "type");
CREATE INDEX "CreatorKitFact_revisionId_accessLevel_sortOrder_idx"
  ON "CreatorKitFact"("revisionId", "accessLevel", "sortOrder");
CREATE INDEX "CreatorKitClaim_revisionId_type_accessLevel_sortOrder_idx"
  ON "CreatorKitClaim"("revisionId", "type", "accessLevel", "sortOrder");
CREATE INDEX "CreatorKitRule_revisionId_accessLevel_sortOrder_idx"
  ON "CreatorKitRule"("revisionId", "accessLevel", "sortOrder");
CREATE UNIQUE INDEX "PublicationRequirements_revisionId_key"
  ON "PublicationRequirements"("revisionId");

ALTER TABLE "CreatorKit"
  ADD CONSTRAINT "CreatorKit_activeRevisionId_fkey"
  FOREIGN KEY ("activeRevisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CreatorKit_draftRevisionId_fkey"
  FOREIGN KEY ("draftRevisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitScenario"
  ADD CONSTRAINT "CreatorKitScenario_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitFact"
  ADD CONSTRAINT "CreatorKitFact_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitClaim"
  ADD CONSTRAINT "CreatorKitClaim_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreatorKitRule"
  ADD CONSTRAINT "CreatorKitRule_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationRequirements"
  ADD CONSTRAINT "PublicationRequirements_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "CreatorKitRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
