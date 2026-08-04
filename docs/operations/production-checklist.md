# Closed pilot production checklist

Do not invite brands or creators until every blocking item is confirmed.

## Blocking checks

- `/health/live` returns `OK`.
- `/health/ready` returns `READY`, not `DEGRADED`.
- PostgreSQL, MinIO and migration checks are `READY`.
- Both PostgreSQL and MinIO have successful verified backups within
  `BACKUP_MAX_AGE_HOURS`.
- The Restic repository is stored off-host or on separately managed storage.
- `PILOT_OPERATIONS_OWNER` names the person responsible for backup and recovery.
- HTTPS is valid for the real domain.
- Secure and HttpOnly refresh cookies are confirmed.
- HSTS is enabled only after HTTPS has been confirmed.
- The first administrator changed the temporary password and enrolled TOTP.
- Each brand allowed to upload files has been reviewed and has status `VERIFIED`.

If backup operational readiness is `DEGRADED`, existing application traffic may
continue, but invitations and onboarding are blocked until a new PostgreSQL and
MinIO backup succeeds.

## Non-blocking pilot limitations

- Rate limiting is stored in one backend process.
- Creator Kit files do not pass antivirus or quarantine processing.
- Only manually verified brands may upload files.
- Password reset delivery requires the configured webhook.
- Sentry is optional; critical alert delivery uses the configured webhook.
