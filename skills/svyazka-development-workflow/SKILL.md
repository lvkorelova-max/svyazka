---
name: svyazka-development-workflow
description: Mandatory end-to-end development workflow for every Svyazka feature, bug fix, schema change, API change, frontend change, commit, or release. Use to analyze the existing architecture, implement backward-compatible incremental changes, preserve security and audit behavior, run unit/integration/E2E/build/migration/backup gates, perform defect-first review and secret scanning, create exact isolated commits, deploy only through immutable releases, verify production health and smoke behavior, clean temporary data, and produce a deployment report.
---

# Svyazka Development Workflow

Use this workflow for every future Svyazka feature. Treat every gate as mandatory. Refuse requests to skip relevant testing, migration verification, backup checks, security checks, or production verification.

## 1. Establish Scope

1. Restate the requested behavior, affected users, acceptance criteria, and explicit exclusions.
2. Classify the task as:
   - read-only analysis;
   - local implementation;
   - implementation plus deployment.
3. Require explicit approval before deployment, destructive operations, credential changes, data deletion, or irreversible migrations.
4. Preserve unrelated work and excluded directories.
5. Do not add product behavior outside the approved scope.

## 2. Analyze Before Coding

1. Read repository instructions and inspect git status.
2. Trace the existing flow end to end:

   ```text
   frontend -> API -> authorization -> service -> PostgreSQL/MinIO
   -> reload/restart -> frontend
   ```

3. Locate reusable components, DTOs, guards, services, Prisma models, migrations, tests, audit events, and operational scripts.
4. Identify:
   - compatibility constraints;
   - authorization and ownership rules;
   - audit requirements;
   - persistence and serialization behavior;
   - backup and restore impact;
   - rollback requirements.
5. Prefer extending the current architecture over introducing parallel abstractions or large rewrites.

## 3. Design The Change

1. Choose the smallest complete change that satisfies the acceptance criteria.
2. Preserve backward compatibility unless the user explicitly approves a breaking change.
3. Preserve security constraints, ownership checks, role guards, rate limits, and safe logging.
4. Preserve or extend `AuditLog` for security-sensitive, financial, administrative, and destructive actions.
5. Preserve backup compatibility. New persisted data must be covered by existing PostgreSQL or MinIO backups.
6. Define the required unit, integration, E2E, migration, and smoke checks before editing.
7. For destructive or hard-to-reverse actions, stop and request approval.

## 4. Implement Incrementally

1. Make focused changes in dependency order: schema, backend, frontend, tests, operations, documentation.
2. Reuse existing components and utilities whenever they meet the requirement.
3. Keep code and naming consistent with the surrounding architecture.
4. Do not weaken validation, authorization, audit logging, financial integer rules, or secret handling.
5. Create small logical commits containing only verified, related changes.
6. Never include secrets, credentials, private keys, tokens, production data, `.env.production`, TOTP data, recovery codes, or temporary exports.

## 5. Verify Locally

Read [quality-gates.md](references/quality-gates.md) and run every applicable gate.

At minimum:

1. Add regression coverage for the requested behavior and important forbidden paths.
2. Run relevant unit, integration, and E2E tests.
3. Build frontend and backend successfully.
4. Run production-like smoke checks using production configuration without production data.
5. Run `git diff --check` and inspect the complete diff.
6. Stop on a relevant failure, fix it, and rerun affected checks.
7. Do not report a suite as passed when it did not execute.

## 6. Verify Persistence And Migrations

When Prisma, persisted data, or storage behavior changes:

1. Run Prisma validation and generation.
2. Apply migrations to a clean database.
3. Apply migrations to a representative existing database.
4. Verify data preservation, constraints, indexes, and restart persistence.
5. Verify the migration is compatible with backup and restore procedures.
6. Never use production seed during deployment.
7. Do not improvise destructive rollback. Use a corrective migration or the documented restore procedure.

## 7. Review And Commit Precisely

After all relevant local and migration gates pass, complete the isolated commit procedure in [quality-gates.md](references/quality-gates.md):

1. Review the complete intended change with a defect-first stance.
2. Scan all intended tracked and untracked files for secrets without printing secret values.
3. Define an explicit allowlist of paths for the logical commit.
4. Stage only those paths. Never use broad staging such as `git add .` or `git add -A`.
5. Verify the staged name list, diff, whitespace, tests, and absence of unrelated files.
6. Commit only after all relevant gates pass.
7. Verify the commit SHA, subject, exact file list, diff summary, and remaining worktree state.
8. If the commit includes or omits an unexpected file, stop and correct it without discarding user work.

## 8. Gate Production

Production deployment is allowed only when explicitly approved and all relevant local checks pass.

Before deployment:

1. Verify a clean worktree and record the exact commit SHA.
2. Perform a read-only production preflight.
3. Verify current health endpoints, container health, disk capacity, and rollback target.
4. Verify backup operational readiness.
5. Create and verify a fresh backup when the change or deployment policy requires it.
6. Block deployment if required backups, manifests, checksums, repository checks, or migration safeguards fail.

For detailed deployment commands and backup evidence, use `$svyazka-safe-deploy`.

## 9. Deploy Safely

1. Never edit the active production release or application files in place.
2. Build from the exact verified commit.
3. Create a new immutable release directory.
4. Preserve production secrets without displaying or copying them into source control.
5. Validate production Compose configuration.
6. Run `prisma migrate deploy` without seed.
7. Atomically switch the active release.
8. Recreate only affected services when safe.
9. Never delete production volumes, backups, secrets, or release history as part of a normal deployment.

## 10. Verify Production

1. Confirm the active production commit equals the intended commit.
2. Verify live and ready health endpoints.
3. Verify affected containers and recent error logs.
4. Run an exact production smoke test for the implemented behavior, including authorization and persistence when relevant.
5. Confirm backups remain healthy after deployment.
6. If smoke verification fails, fix forward immediately or roll back to the recorded release.

## 11. Clean Up

1. Remove all temporary users, sessions, offers, applications, files, orders, commissions, audit entries, and other test records created by smoke tests.
2. Delete temporary objects from storage when applicable.
3. Prove cleanup with exact zero-count queries or equivalent checks.
4. Do not delete legitimate production data.

## 12. Report

Use the report template in [quality-gates.md](references/quality-gates.md).

Always include:

- implemented changes;
- migrations and their verification;
- unit, integration, E2E, build, and smoke results;
- backup status;
- active release and production health;
- temporary-data cleanup;
- remaining risks and anything not verified.

Never claim completion when a mandatory gate is skipped, failed, or unverified.
