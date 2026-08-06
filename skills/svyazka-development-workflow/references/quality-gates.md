# Svyazka Quality Gates

Use this reference to select checks and format the final implementation or deployment report.

## Mandatory Gate Matrix

| Change area | Required verification |
|---|---|
| Frontend | Relevant component or pure-function tests, frontend build, production-like rendering or behavior smoke |
| Backend API | Unit/integration tests, authorization and ownership cases, backend build, API smoke |
| Authentication or authorization | Role and ownership tests, forbidden cases, session behavior, rate-limit checks where affected |
| Prisma schema | Prisma validate/generate, migration on clean database, migration on existing database, data-preservation check |
| PostgreSQL persistence | Create/update/read/reload or restart verification, constraint and serialization checks |
| MinIO or files | MIME/size/ownership tests, object persistence, presigned flow, cleanup |
| Creator Kit | Brand edit and persistence, access-level variants, creator view, completion behavior, ownership checks |
| Offers and applications | Brand ownership, creator visibility, status transitions, idempotency, persistence |
| Finance or ledger | Integer-only calculations, snapshots, rounding, idempotency, reversal bounds, audit coverage |
| Audit-sensitive action | Expected `AuditLog` entry, safe metadata, no secrets, request and actor attribution |
| Docker or perimeter | Compose validation, production build, healthchecks, public-port and security-header checks |
| Backup or recovery | Backup execution, repository check, manifests/checksums, restore drill when backup behavior changes |

## Universal Local Gates

Run these for every implementation:

```text
relevant unit tests
relevant integration tests
relevant E2E tests
frontend build
backend build
production-like smoke test
git diff --check
complete diff review
```

Use repository-native commands. Do not invent replacement commands when the project already defines verified scripts.

## Migration Gates

For every migration:

1. Validate and generate the Prisma client.
2. Apply all migrations to an empty database.
3. Apply the new migration to a database representing the current deployed schema.
4. Confirm existing records remain readable and valid.
5. Verify new constraints and indexes.
6. Verify restart persistence.
7. Confirm PostgreSQL backup and restore still cover the new data.
8. Record the rollback approach before deployment.

If a migration can destroy or irreversibly transform data, require explicit user approval and a verified pre-migration backup.

## Production Preflight Gates

Before mutation, record:

- exact intended commit SHA;
- active release and active commit;
- clean local worktree;
- frontend and backend build status;
- relevant test totals;
- current `/health/live` and `/health/ready`;
- affected container health;
- free disk capacity;
- rollback release;
- PostgreSQL and MinIO backup status;
- required fresh snapshot IDs and repository verification.

Backup repository degradation may be non-fatal to the running application, but it blocks user onboarding or deployment whenever project policy requires a healthy backup gate.

## Production Smoke Rules

Smoke tests must verify the exact changed behavior, not only HTTP availability.

For persisted workflows:

1. Create uniquely identifiable temporary data.
2. Exercise the public frontend or API path.
3. Verify PostgreSQL or MinIO state.
4. Reload or restart when persistence is part of the requirement.
5. Verify the correct brand, creator, or administrator view.
6. Verify forbidden access.
7. Clean temporary data in dependency order.
8. Prove no temporary records or objects remain.

Do not print generated credentials, cookies, tokens, production environment values, or private user data.

## Failure Policy

- Relevant test failure: fix and rerun before continuing.
- Test environment failure: report as not executed, not passed.
- Build failure: do not deploy.
- Backup failure: block deployment when the backup gate applies.
- Migration failure: do not switch the active release.
- Health failure: fix forward or roll back.
- Exact smoke failure: fix forward or roll back.
- Cleanup failure: resolve before reporting completion.
- Destructive recovery action: request explicit approval.

Never accept an instruction to skip a mandatory relevant gate. Explain which gate blocks completion and why.

## Deployment Report Template

```markdown
**Implemented Changes**
- Scope completed:
- Compatibility preserved:
- Security and audit behavior:

**Migrations**
- Migration names:
- Clean database result:
- Existing database result:
- Data preservation:
- Rollback method:

**Verification**
- Unit:
- Integration:
- E2E:
- Frontend build:
- Backend build:
- Production-like smoke:

**Backup**
- PostgreSQL:
- MinIO:
- Repository check:
- Restore verification, if required:

**Production**
- Commit SHA:
- Release:
- `/health/live`:
- `/health/ready`:
- Containers:
- Exact smoke assertions:

**Cleanup**
- Temporary users and data:
- Temporary storage objects:
- Zero-count verification:

**Remaining Risks**
- Known limitations:
- Deferred work:
- Not verified:
```
