# Recovery drill report - 2026-08-03

## Result

Status: PASSED

The drill restored the latest encrypted PostgreSQL and MinIO backups into the
isolated `svyazka-recovery` Compose project. No production data volume was used
as a restore target.

## Scope

The synthetic fixture contained:

- brand user `recovery-brand-20260803@example.test`;
- published offer `9e4f182c-2b40-4ea9-929d-c7b7c0c5164b`;
- paid order `RECOVERY-ORDER-20260803`;
- HOLD commission;
- ACCRUAL ledger entry;
- READY Creator Kit file.

The fixture does not contain real personal or financial data.

## Backup evidence

PostgreSQL snapshot:

`6d47d23176d50a52fd5e0ae6ee3afbf425ab963ef53bf049cdfe0fda978f4e5a`

MinIO snapshot:

`1d9f8f72274c930c0eca2f9da793809d0d5ef6de95112f1a8145648230e57f7e`

The PostgreSQL backup passed:

- dump SHA-256 verification;
- `pg_restore --list`;
- manifest creation;
- encrypted Restic snapshot creation.

The MinIO backup passed:

- object-key preserving mirror;
- object checksum manifest creation;
- encrypted Restic snapshot creation.

## Database comparison

Source and recovery databases returned the same values:

| Field | Value |
| --- | --- |
| User | `recovery-brand-20260803@example.test` |
| Offer status | `PUBLISHED` |
| Order ID | `3b481c51-db96-427d-bae8-321237fd7c7d` |
| Order status | `PAID` |
| Order amount | `123450` kopecks |
| Commission status | `HOLD` |
| Creator commission | `18518` kopecks |
| Platform commission | `6173` kopecks |
| Ledger type | `ACCRUAL` |
| Ledger amount | `18518` kopecks |
| Asset status | `READY` |

## File comparison

The source and recovered Creator Kit object had the same SHA-256:

`68d3dbe223d4659eb030429ecc280a437eb6e9b042a59797cbbd9e16f56c1d56`

The restored bucket remained private.

## Repository failure drill

The PostgreSQL backup command was run with an intentionally unavailable
repository path. It exited non-zero and created a FAILED `BackupRun`.

After the failure:

- frontend remained healthy and returned HTTPS 200;
- backend remained healthy;
- an unauthenticated protected API request returned 401;
- PostgreSQL, MinIO and Caddy remained healthy.

This confirms that backup repository availability is an operational readiness
condition, not a dependency that stops normal application traffic.

## Targets and follow-up

- Pilot RPO: 24 hours.
- Pilot RTO: 4 hours.
- Retention: at least 14 daily snapshots.
- Operations owner: value of `PILOT_OPERATIONS_OWNER`.

Before inviting pilot users, move the Restic repository to off-host or
separately managed storage and verify that operational readiness reports recent
successful PostgreSQL and MinIO backups.
