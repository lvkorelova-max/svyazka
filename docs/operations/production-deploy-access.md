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
