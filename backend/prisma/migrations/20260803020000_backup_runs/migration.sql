CREATE TYPE "BackupKind" AS ENUM ('POSTGRES', 'MINIO');
CREATE TYPE "BackupRunStatus" AS ENUM ('STARTED', 'SUCCESS', 'FAILED');

CREATE TABLE "BackupRun" (
  "id" UUID NOT NULL,
  "kind" "BackupKind" NOT NULL,
  "status" "BackupRunStatus" NOT NULL DEFAULT 'STARTED',
  "repository" VARCHAR(500) NOT NULL,
  "snapshotId" VARCHAR(160),
  "manifest" JSONB,
  "errorMessage" VARCHAR(1000),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupRun_kind_startedAt_idx" ON "BackupRun"("kind", "startedAt");
CREATE INDEX "BackupRun_status_startedAt_idx" ON "BackupRun"("status", "startedAt");
