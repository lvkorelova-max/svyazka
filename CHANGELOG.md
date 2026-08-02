# Changelog

All notable changes to this project are documented in this file.

The project uses semantic versioning. Dates use the ISO `YYYY-MM-DD` format.

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
