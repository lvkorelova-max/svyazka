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

## Review And Isolated Commit Gate

Complete this gate after implementation checks and before deployment.

### 1. Establish The Commit Allowlist

1. Inspect `git status --short --branch`.
2. List the exact paths belonging to the logical change.
3. Treat every other modified or untracked path as unrelated unless proven otherwise.
4. Preserve unrelated user and generated work. Do not reset, clean, delete, or overwrite it.

### 2. Perform A Defect-First Review

Review the complete intended diff and all intended untracked files for:

- behavioral defects and regressions;
- missing authorization or ownership checks;
- weakened validation, audit logging, or safe error handling;
- backward compatibility breaks;
- data-loss and migration risks;
- financial rounding or idempotency errors;
- missing tests and incomplete persistence paths;
- unrelated changes or generated artifacts.

Report findings by severity and file location. Do not commit while an actionable relevant defect remains. After a fix, rerun the affected review and verification gates.

### 3. Scan For Secrets

Use the repository's configured secret scanner when available. Scan:

- the complete intended diff;
- intended untracked files;
- generated archives or packages;
- the staged snapshot before commit.

Cover at least passwords, access keys, private keys, tokens, cookies, TOTP secrets, recovery codes, production environment files, database URLs, backup credentials, and private production data.

Do not print discovered secret values. Report only the finding type and file location needed for remediation. Treat an uncertain credential-like value as blocked until reviewed.

### 4. Stage Exact Paths

Use an explicit path allowlist:

```bash
git add -- <path-1> <path-2> <path-3>
```

Never use:

```text
git add .
git add -A
git commit -a
```

After staging, run:

```bash
git status --short
git diff --cached --check
git diff --cached --name-status
git diff --cached --stat
git diff --cached
```

For binary artifacts, verify archive integrity and list their contents separately. Compare the staged name list exactly with the allowlist. Confirm unrelated files remain unstaged.

If an extra path was staged, unstage only that path without altering its worktree contents, then repeat the staged checks.

### 5. Create The Isolated Commit

Commit only when:

- relevant tests and builds passed;
- review has no unresolved findings;
- secret scan passed;
- staged paths exactly equal the allowlist;
- staged diff contains one logical change;
- the commit message accurately describes that change.

Do not amend, squash, rebase, or rewrite existing commits unless explicitly requested.

### 6. Verify After Commit

Run:

```bash
git rev-parse HEAD
git show --stat --oneline --decorate --no-renames HEAD
git show --format= --name-status HEAD
git status --short --branch
```

Verify:

- the new commit SHA is recorded;
- the subject is correct;
- the committed file list exactly matches the allowlist;
- no unrelated changes entered the commit;
- unrelated work remains present and unmodified;
- no intended file was omitted;
- the worktree state is understood and reported.

Repeat the safe secret scan against the committed snapshot. Do not push unless the user requested or approved pushing.

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
- Review findings:
- Secret scan:

**Commit**
- Commit SHA:
- Commit subject:
- Exact committed paths:
- Unrelated work preserved:
- Post-commit verification:

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
