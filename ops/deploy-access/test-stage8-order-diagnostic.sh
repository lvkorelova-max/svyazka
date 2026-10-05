#!/usr/bin/env bash
set -Eeuo pipefail

source_script="$(cd "$(dirname "$0")" && pwd)/svyazka-deployctl"
helper_script="$(cd "$(dirname "$0")" && pwd)/stage8-order-diagnostic.js"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

assert_fail() {
  if "$@" >/dev/null 2>&1; then
    printf 'FAIL: expected command to fail: %s\n' "$*" >&2
    exit 1
  fi
}

copy_for_test() {
  local copy="$test_root/deployctl"
  cp "$source_script" "$copy"
  cp "$helper_script" "$test_root/stage8-order-diagnostic.js"
  perl -0pi -e '
    s#readonly incoming_root="/var/lib/svyazka-deploy/incoming"#readonly incoming_root="'"$test_root"'/incoming"#;
    s#readonly releases_root="/opt/svyazka/releases"#readonly releases_root="'"$test_root"'/releases"#;
    s#readonly deploy_root="/opt/svyazka/deploy"#readonly deploy_root="'"$test_root"'/deploy"#;
    s#readonly current_link="/opt/svyazka/current"#readonly current_link="'"$test_root"'/current"#;
    s#\[\[ "\$EUID" -eq 0 \]\] \|\| fail "root execution required"#:#;
    s#/usr/bin/docker#'"$test_root"'/docker#g;
    s#/usr/bin/logger#'"$test_root"'/logger#g;
    s#/usr/local/libexec/svyazka-stage8-order-diagnostic.js#'"$test_root"'/stage8-order-diagnostic.js#g;
    s/ -o root -g root//g;
    s/chown root:root/chown/g;
  ' "$copy"
  chmod +x "$copy"
  printf '%s\n' "$copy"
}

cat > "$test_root/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cat >/dev/null
if [[ "${FAKE_STATUS:-OK}" == "BRAND_NOT_FOUND" ]]; then
  printf '%s\n' '{"status":"BRAND_NOT_FOUND","brandName":"MISSING","fromUtc":"2026-10-03T17:00:00Z","toUtc":"2026-10-04T17:00:00Z"}'
  exit 0
fi
if [[ "${FAKE_STATUS:-OK}" == "BRAND_AMBIGUOUS" ]]; then
  printf '%s\n' '{"status":"BRAND_AMBIGUOUS","matchCount":2,"fromUtc":"2026-10-03T17:00:00Z","toUtc":"2026-10-04T17:00:00Z"}'
  exit 0
fi
printf '%s\n' '{"status":"OK","brand":{"id":"opaque-brand-id","brandName":"BYSOLA","timezone":"Europe/Moscow"},"range":{"fromUtc":"2026-10-03T17:00:00Z","toUtc":"2026-10-04T17:00:00Z","semantics":"half_open_utc_[from,to)"},"clickSessions":{"count":0,"items":[]},"events":[],"summary":{"eventCount":0,"canonicalOrderCount":0,"attributedOrderCount":0,"financeAcknowledgedCount":0}}'
EOF
cat > "$test_root/logger" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$test_root/docker" "$test_root/logger"

deployctl="$(copy_for_test)"

valid_output="$("$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z)"
[[ "$valid_output" == *'"status":"OK"'* ]] ||
  { printf 'FAIL: valid diagnostic invocation was not accepted\n' >&2; exit 1; }

assert_fail "$deployctl" stage8-order-diagnostic 'BYSOLA;cat' \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic 'BYSOLA$(touch /tmp/pwned)' \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic "BYSOLA' OR '1'='1" \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-03 2026-10-04T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-03T17:00:00Z 2026-10-12T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-04T17:00:00Z 2026-10-04T17:00:00Z
assert_fail "$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-03T17:00:00Z
assert_fail "$deployctl" unknown-command

not_found_output="$(FAKE_STATUS=BRAND_NOT_FOUND "$deployctl" stage8-order-diagnostic MISSING \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z)"
[[ "$not_found_output" == *'"status":"BRAND_NOT_FOUND"'* ]] ||
  { printf 'FAIL: nonexistent brand was not reported safely\n' >&2; exit 1; }
ambiguous_output="$(FAKE_STATUS=BRAND_AMBIGUOUS "$deployctl" stage8-order-diagnostic BYSOLA \
  2026-10-03T17:00:00Z 2026-10-04T17:00:00Z)"
[[ "$ambiguous_output" == *'"status":"BRAND_AMBIGUOUS"'* ]] ||
  { printf 'FAIL: ambiguous brand was not reported safely\n' >&2; exit 1; }
if grep -Eiq 'secret|password|api.?key|webhook.?key|payload|ipHash|userAgentHash' <<<"$valid_output"; then
  printf 'FAIL: diagnostic output exposed a sensitive/raw field\n' >&2
  exit 1
fi

diagnostic_block="$(cat "$helper_script")"
for forbidden in '.create(' '.update(' '.upsert(' '.delete(' 'processOrderEvent' 'enqueueFinancialHandoff' 'raw'; do
  if grep -Fq "$forbidden" <<<"$diagnostic_block"; then
    printf 'FAIL: diagnostic contains forbidden mutation/raw path: %s\n' "$forbidden" >&2
    exit 1
  fi
done
grep -Fq 'const LIMIT = 200;' <<<"$diagnostic_block" ||
  { printf 'FAIL: diagnostic is not bounded\n' >&2; exit 1; }
grep -Fq 'half_open_utc_[from,to)' <<<"$diagnostic_block" ||
  { printf 'FAIL: explicit UTC semantics are missing\n' >&2; exit 1; }
grep -Fq 'BRAND_NOT_FOUND' <<<"$diagnostic_block" ||
  { printf 'FAIL: nonexistent brand is not handled safely\n' >&2; exit 1; }
grep -Fq 'BRAND_AMBIGUOUS' <<<"$diagnostic_block" ||
  { printf 'FAIL: ambiguous brand is not handled safely\n' >&2; exit 1; }
grep -Fq 'diagnostic_helper' "$source_script" ||
  { printf 'FAIL: helper path is not fixed in deployctl\n' >&2; exit 1; }
grep -Fq 'readonly diagnostic_helper="/usr/local/libexec/svyazka-stage8-order-diagnostic.js"' "$source_script" ||
  { printf 'FAIL: helper path is not a fixed readonly constant\n' >&2; exit 1; }
if grep -Eq 'diagnostic_helper=.*\\$|< \"\\$[0-9]' "$source_script"; then
  printf 'FAIL: helper path appears caller-controlled\n' >&2
  exit 1
fi
for secret_field in 'encryptedWebhookKey' 'encryptedCloudPaymentsApiSecret' \
  'webhookKey' 'apiSecret' 'payload:' 'ipHash' 'userAgentHash'; do
  if grep -Fq "$secret_field" <<<"$diagnostic_block"; then
    printf 'FAIL: sensitive/raw field appears in diagnostic: %s\n' "$secret_field" >&2
    exit 1
  fi
done

printf 'PASS: stage8 order diagnostic contract tests\n'
