#!/usr/bin/env bash
set -Eeuo pipefail

export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/cache}"

libpq_url() {
  local value="$1"
  printf '%s' "$value" | sed 's/[?].*$//'
}

require_env() {
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      printf 'Missing required environment variable: %s\n' "$name" >&2
      exit 1
    fi
  done
}

ensure_repository() {
  require_env RESTIC_REPOSITORY RESTIC_PASSWORD
  if ! restic snapshots >/dev/null 2>&1; then
    restic init >/dev/null
  fi
}

start_backup_run() {
  local kind="$1"
  require_env DATABASE_URL RESTIC_REPOSITORY
  psql "$(libpq_url "$DATABASE_URL")" -v ON_ERROR_STOP=1 -qAt \
    -v kind="$kind" -v repository="$RESTIC_REPOSITORY" <<'SQL'
INSERT INTO "BackupRun" ("id", "kind", "status", "repository", "startedAt")
VALUES (gen_random_uuid(), :'kind'::"BackupKind", 'STARTED', :'repository', NOW())
RETURNING "id";
SQL
}

complete_backup_run() {
  local run_id="$1"
  local snapshot_id="$2"
  local manifest_json="$3"
  psql "$(libpq_url "$DATABASE_URL")" -v ON_ERROR_STOP=1 \
    -v run_id="$run_id" -v snapshot_id="$snapshot_id" -v manifest="$manifest_json" <<'SQL'
UPDATE "BackupRun"
SET "status" = 'SUCCESS',
    "snapshotId" = :'snapshot_id',
    "manifest" = :'manifest'::jsonb,
    "completedAt" = NOW(),
    "errorMessage" = NULL
WHERE "id" = :'run_id'::uuid;
SQL
}

fail_backup_run() {
  local run_id="${1:-}"
  local message="${2:-Backup command failed}"
  if [ -n "$run_id" ] && [ -n "${DATABASE_URL:-}" ]; then
    psql "$(libpq_url "$DATABASE_URL")" -v ON_ERROR_STOP=1 \
      -v run_id="$run_id" -v message="${message:0:1000}" <<'SQL' || true
UPDATE "BackupRun"
SET "status" = 'FAILED',
    "errorMessage" = :'message',
    "completedAt" = NOW()
WHERE "id" = :'run_id'::uuid;
SQL
  fi
}

retention_days() {
  local value="${BACKUP_RETENTION_DAYS:-14}"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 14 ]; then
    printf 'BACKUP_RETENTION_DAYS must be an integer of at least 14\n' >&2
    exit 1
  fi
  printf '%s' "$value"
}
