# Changelog

All notable changes to this project are documented in this file.

The project uses semantic versioning. Dates use the ISO `YYYY-MM-DD` format.

## [0.5.0] - 2026-08-04

### Financial correctness

- Prevented false negative ledger balances for `PENDING` order cancellation.
- Frozen offer BPS and preview commission amounts before CSV confirmation.
- Added within-file duplicate detection and safe payout cancellation.
- Added idempotent reversal caps and post-payout creator debt handling.

### Security

- Added route-specific rate limiting and temporary login lockout.
- Added hashed one-time password reset tokens and session revocation.
- Added mandatory ADMIN TOTP, hashed one-time recovery codes and emergency MFA reset.
- Added critical-action AuditLog records with request IDs.
- Restricted Creator Kit uploads to administrator-verified brands.
- Added a production-only first-admin bootstrap and blocked production seed.

### Operations

- Added production multi-stage Docker images, Caddy HTTPS perimeter and security headers.
- Added read-only root filesystems, non-root processes, healthchecks and resource limits.
- Kept PostgreSQL, MinIO and MinIO Console off public host ports.
- Added `/health/live`, `/health/ready`, structured JSON logs and critical alert webhook support.
- Added a deployment command that always runs Prisma migrations before application update.

### Backup and recovery

- Added encrypted PostgreSQL and MinIO backups with 14-day retention.
- Added manifests, checksums, `pg_restore --list` validation and protected restore commands.
- Completed an isolated recovery drill for user, offer, order, commission, ledger and file data.
- Made backup failure degrade operational readiness without stopping application traffic.

### Verification

- Added Stage 5 financial, security, brand verification and readiness coverage.
- Verified migrations on existing and clean databases.
- Verified production images contain no high-severity production dependency vulnerabilities.

## [0.4.0] - 2026-08-01

### Added

- Click tracking for active affiliate links without storing raw IP addresses.
- Two-step CSV order import with persistent preview rows and validation errors.
- Attribution by `click_id`, `affiliate_code`, and `promo_code`.
- Order, commission, payout, and immutable ledger models in PostgreSQL.
- Full, cancelled, returned, and partially returned order handling.
- Manual hold release and administrator-confirmed payouts.
- Post-payout creator debt records for later returns.
- Brand analytics by creator, including period filters and aggregate totals.
- Real sales and earnings data in brand, creator, and administrator interfaces.
- Stage 4 Prisma migration, idempotent seed data, and financial E2E coverage.

### Security

- HMAC-SHA256 IP hashing with a server-side salt.
- Backend ownership and role checks for imports, orders, analytics, and payouts.
- Integer-only monetary calculations with basis-point commission snapshots.
- Production dependency audit reports no known vulnerabilities.

## [0.3.0] - 2026-07-30

### Added

- Creator applications for published offers.
- Brand approval and rejection workflow.
- Unique affiliate links and promo codes.
- Active, paused, and revoked affiliate relationships.
- Protected Digital Creator Kit access for approved creators.

## [0.2.0] - 2026-07-29

### Added

- Creator Kit data models and private MinIO storage.
- Presigned uploads and downloads with S3 HEAD validation.
- Digital and Product access levels.
- Asset status, expiration, MIME, extension, and size filtering.

## [0.1.0] - 2026-07-28

### Added

- NestJS backend, PostgreSQL, Prisma, and Docker Compose.
- Registration, login, refresh sessions, logout, and role guards.
- Brand and creator profiles.
- Persistent offers with protected ownership and status transitions.
- React integration with the original interface.
