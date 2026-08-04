# Backup and recovery runbook

## Targets

- RPO: 24 hours.
- RTO: 4 hours.
- Retention: at least 14 daily Restic snapshots.
- Operations owner: the named person in `PILOT_OPERATIONS_OWNER`.
- PostgreSQL and MinIO are backed up into an encrypted Restic repository that is separate from both production data volumes.

For a real pilot, map the `backup_repository` volume to off-host storage or a separately managed encrypted disk. A repository on the same physical host protects against logical errors but not host loss.

## Operational behavior

The main frontend and backend do not depend on `backup-service`. If the repository is missing, locked, full or unavailable:

1. `backup-service` exits with an error and is restarted by Docker.
2. A failed `BackupRun` is written to PostgreSQL when the database is reachable.
3. Operational readiness becomes `DEGRADED`.
4. The admin panel and JSON logs show a critical warning.
5. The production checklist prohibits inviting users until both PostgreSQL and MinIO have a recent successful backup.
6. Existing application traffic continues.

Start the main system independently:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Enable the daily backup service:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile backup up -d backup-service
```

## Manual backup

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile backup run --rm --entrypoint /opt/backup/backup-all backup-service
```

Each PostgreSQL backup contains a custom-format dump, `pg_restore --list` output, manifest and SHA-256 checksums. MinIO backups preserve object keys and contain an object checksum manifest.

## Restore protection

Restore scripts require an exact target-specific confirmation. Production restores additionally require `ALLOW_PRODUCTION_RESTORE=true`. Never restore over the only production copy. Restore first into a clean recovery environment and verify it.

PostgreSQL:

```bash
RESTORE_CONFIRMATION="RESTORE POSTGRES target_database" \
docker compose ... run --rm --entrypoint /opt/backup/restore-postgres recovery-tool
```

MinIO:

```bash
RESTORE_CONFIRMATION="RESTORE MINIO target_bucket" \
docker compose ... run --rm --entrypoint /opt/backup/restore-minio recovery-tool
```

## Recovery drill

1. Create synthetic user, offer, order, commission, ledger entry and Creator Kit file.
2. Run `backup-all`.
3. Start `docker-compose.recovery.yml`.
4. Restore PostgreSQL and MinIO into the clean recovery volumes.
5. Compare identifiers, statuses and financial amounts in source and recovery PostgreSQL.
6. Compare the Creator Kit object checksum in source and recovery MinIO.
7. Record start/end time and result.
8. Remove recovery containers and volumes only after evidence is saved.

Cleanup:

```bash
docker compose -f docker-compose.recovery.yml down -v
```

Never use `down -v` against `docker-compose.prod.yml`.
