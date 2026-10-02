# Production Deployment Access

## Purpose

Production deployments use one dedicated Ed25519 key for the existing
`deploy` user. The key is not shared with GitHub, application containers, or
backup storage.

The private key is stored only on the approved deployment workstation:

```text
~/.ssh/svyazka-production-deploy
```

The public-key fingerprint created on August 9, 2026 is:

```text
SHA256:wfiCEHGzHVnxM7pqBWZXsg+dpuHk+ARntNCOOyfgDAQ
```

## Security Model

- Remote root login remains disabled.
- SSH password and keyboard-interactive authentication remain disabled.
- Only public-key authentication is accepted for `deploy`.
- The production key has an `authorized_keys` forced command and `restrict`.
- Interactive shell, PTY, agent forwarding, TCP forwarding, X11 forwarding,
  and tunneling are disabled.
- `deploy` is not a member of `sudo` or `docker`.
- The only passwordless root command is the root-owned
  `/usr/local/sbin/svyazka-deployctl` wrapper.
- The wrapper accepts only validated release names, archive names, SHA-256
  values, commit SHAs, services, and log windows.
- Production environment files and release directories are owned by root.

## Normal Use

Use the permanent SSH alias:

```bash
ssh svyazka-production svyazka-deployctl preflight
```

For an approved application deployment, use:

```bash
ops/deploy-access/deploy-release FULL_COMMIT_SHA change-slug backend frontend
```

The helper requires an explicit `DEPLOY <short-sha>` confirmation. Successful
activation does not replace the exact production smoke test or cleanup report.

The deployment workflow is:

1. Run local tests and builds.
2. Create a Git archive from the exact commit and calculate SHA-256.
3. Run `svyazka-deployctl preflight`.
4. Run `svyazka-deployctl backup`.
5. Stream the archive with `svyazka-deployctl upload`.
6. Run `prepare`, `validate`, `build`, and `migrate`.
7. Preserve affected running images with `preserve-image`.
8. Run `activate` for only the affected application services.
9. Verify health, logs, exact smoke behavior, backup readiness, and rollback.
10. Remove the uploaded archive with `cleanup-upload`.

The wrapper never runs a production seed and never removes Docker volumes.

## Feature Flags

Feature flags are controlled independently from application release
activation. The production wrapper accepts only the following names:

```text
STAGE7_FINANCE_ENABLED
STAGE7_FINANCIAL_ACTIVATION_ENABLED
STAGE8_TRACKER_ENABLED
STAGE8_TILDA_ENABLED
STAGE8_ORDER_INGESTION_ENABLED
STAGE8_ATTRIBUTION_SHADOW_ENABLED
STAGE8_AUTO_ATTRIBUTION_ENABLED
STAGE8_FINANCE_HANDOFF_ENABLED
```

To change one flag, use the exact full commit SHA reported by the active
release preflight:

```bash
ssh svyazka-production \
  svyazka-deployctl set-feature-flag FULL_ACTIVE_COMMIT_SHA STAGE8_TRACKER_ENABLED true
```

The command refuses stale commits, invalid values, unknown names, duplicate
definitions, and any mutation outside the active release's
`.env.production`. It writes the root-owned mode-600 file atomically,
recreates only the backend container, and waits for backend readiness. If
recreation or readiness fails, the previous environment is restored
atomically and the backend is recreated with that previous configuration.
The command logs only the flag name, value, and active commit.

Rollback a flag by running the same command with its previous boolean value:

```bash
ssh svyazka-production \
  svyazka-deployctl set-feature-flag FULL_ACTIVE_COMMIT_SHA STAGE8_TRACKER_ENABLED false
```

Changing a flag requires the exact active `COMMIT_SHA`; obtain it with
`svyazka-deployctl preflight` immediately before the change. This command is
for the eight allowlisted feature flags only. Do not use it for secrets,
credentials, database URLs, or any other environment variable.

`preflight` reports each allowlisted feature flag as `NAME=true`,
`NAME=false`, or `NAME=ABSENT`; it does not print unrelated environment
variables or secret values.

The deploy key intentionally cannot replace the privileged wrapper. To
bootstrap or update the root-owned `/usr/local/sbin/svyazka-deployctl`, use
the VPS provider's authenticated web or serial console:

1. Review the wrapper from the approved repository commit.
2. Install it as `root:root` with mode `755` at
   `/usr/local/sbin/svyazka-deployctl`.
3. Run `bash -n` and a read-only `preflight` from the console.
4. Verify the forced-command SSH gate and `sudo -n` policy still permit only
   the wrapper.
5. Re-run the access audit and a normal deployment preflight.

There is intentionally no self-update command for `svyazka-deployctl`.

## Key Rotation

Rotate at least annually and immediately after suspected workstation
compromise:

1. Generate a new dedicated Ed25519 key at a new local path.
2. Record and independently verify its fingerprint.
3. Use the provider web or serial console to add the new restricted
   forced-command entry without removing the old entry. This is an
   infrastructure credential change, not a normal release operation.
4. Verify `preflight` using the new private key.
5. Remove the old public-key entry.
6. Verify the old key is rejected and the new key still works.
7. Securely delete the old local private and public key files.
8. Update this document with the new fingerprint and rotation date.

Never remove the old public key before the new key passes a real connection
test.

## Emergency Revocation

If the private key may be exposed:

1. Stop deployments.
2. Open the VPS provider web or serial console.
3. Remove the line identified by the production key comment from
   `/home/deploy/.ssh/authorized_keys`.
4. Confirm SSH with the compromised key returns `Permission denied`.
5. Review `journalctl` SSH events, `sudo` events, deployment gateway logs,
   active release, container creation times, and recent AuditLog activity.
6. Rotate any secret only when evidence shows it may have been accessed.
7. Create and install a replacement key using the recovery procedure.

Revocation does not require enabling password authentication or root SSH.

## Lost Private Key Recovery

The public key cannot recreate a lost private key.

1. Open the VPS provider web or serial console with the provider account's MFA.
2. Generate a replacement key on the approved deployment workstation.
3. Add the replacement public key to
   `/home/deploy/.ssh/authorized_keys` with the same `restrict` and forced
   command options.
4. Preserve ownership `deploy:deploy`, directory mode `700`, and file mode
   `600`.
5. Verify `preflight` with the replacement key.
6. Remove the lost key's public entry.
7. Verify the lost key is rejected.
8. Update the fingerprint and rotation date in this document.

Do not temporarily enable SSH passwords or remote root login for recovery.

## Verification

After installation or rotation, verify:

```text
permanent key preflight succeeds
interactive shell is rejected
PTY allocation is rejected
port forwarding is rejected
direct docker access is rejected
arbitrary sudo is rejected
svyazka-deployctl preflight succeeds
root login is disabled
password authentication is disabled
previous temporary deployment keys are rejected
```
