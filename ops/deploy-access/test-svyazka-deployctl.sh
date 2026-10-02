#!/usr/bin/env bash
set -Eeuo pipefail

source_script="$(cd "$(dirname "$0")" && pwd)/svyazka-deployctl"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] ||
    { printf 'FAIL: %s\nexpected: %s\nactual: %s\n' "$label" "$expected" "$actual" >&2; exit 1; }
}

assert_contains() {
  local needle="$1"
  local haystack="$2"
  local label="$3"
  [[ "$haystack" == *"$needle"* ]] ||
    { printf 'FAIL: %s\nmissing: %s\n' "$label" "$needle" >&2; exit 1; }
}

new_fixture() {
  local name="$1"
  local root="$test_root/$name"
  mkdir -p "$root/releases/active" "$root/deploy" "$root/incoming" "$root/bin"
  printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$root/releases/active/COMMIT_SHA"
  ln -s "$root/releases/active" "$root/current"
  cat > "$root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "${FAKE_DOCKER_LOG:?}"
state="${FAKE_DOCKER_STATE:?}"
count=0
[[ -f "$state" ]] && count="$(cat "$state")"
count=$((count + 1))
printf '%s\n' "$count" > "$state"
if [[ "${FAKE_DOCKER_FAIL_FIRST:-0}" == 1 && "$count" -eq 1 ]]; then
  exit 1
fi
if [[ "${FAKE_DOCKER_FAIL:-0}" == 1 ]]; then
  exit 1
fi
EOF
  cat > "$root/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state="${FAKE_CURL_STATE:?}"
count=0
[[ -f "$state" ]] && count="$(cat "$state")"
count=$((count + 1))
printf '%s\n' "$count" > "$state"
if [[ "${FAKE_CURL_FAIL_FIRST:-0}" == 1 && "$count" -le 2 ]]; then
  exit 1
fi
if [[ "${FAKE_CURL_FAIL:-0}" == 1 ]]; then
  exit 1
fi
printf 'OK\n'
EOF
  cat > "$root/bin/logger" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "${FAKE_LOGGER_LOG:?}"
EOF
  chmod +x "$root/bin/"*
  printf '%s\n' "$root"
}

build_test_copy() {
  local root="$1"
  local copy="$root/deployctl"
  cp "$source_script" "$copy"
  perl -0pi -e 's#readonly releases_root="/opt/svyazka/releases"#readonly releases_root="'"$root"'/releases"#; s#readonly deploy_root="/opt/svyazka/deploy"#readonly deploy_root="'"$root"'/deploy"#; s#readonly incoming_root="/var/lib/svyazka-deploy/incoming"#readonly incoming_root="'"$root"'/incoming"#; s#readonly current_link="/opt/svyazka/current"#readonly current_link="'"$root"'/current"#; s#/usr/bin/docker#'"$root"'/bin/docker#g; s#/usr/bin/curl#'"$root"'/bin/curl#g; s#/usr/bin/logger#'"$root"'/bin/logger#g; s#  \[\[ "\$EUID" -eq 0 \]\] \|\| fail "root execution required"#  :#; s/seq 1 30/seq 1 2/' "$copy"
  perl -pi -e 's/ -o root -g root//g; s/chown root:root/chown/g; s/chown "\$new_file"/:/g' "$copy"
  chmod +x "$copy"
  printf '%s\n' "$copy"
}

run_flag() {
  local root="$1"
  shift
  FAKE_DOCKER_LOG="$root/docker.log" \
  FAKE_DOCKER_STATE="$root/docker.state" \
  FAKE_LOGGER_LOG="$root/logger.log" \
  FAKE_CURL_STATE="$root/curl.state" \
  "$root/deployctl" "$@"
}

root="$(new_fixture basic)"
build_test_copy "$root" >/dev/null
cat > "$root/current/.env.production" <<'EOF'
UNRELATED=keep
SECRET=never-print-this
STAGE7_FINANCE_ENABLED=true
EOF
output="$(run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE7_FINANCE_ENABLED false 2>"$root/stderr.log")"
assert_eq 'FEATURE_FLAG_UPDATED=STAGE7_FINANCE_ENABLED=false' "$output" "true to false"
assert_contains 'UNRELATED=keep' "$(cat "$root/current/.env.production")" "unrelated env preserved"
assert_contains 'SECRET=never-print-this' "$(cat "$root/current/.env.production")" "secret preserved"
assert_contains 'STAGE7_FINANCE_ENABLED=false' "$(cat "$root/current/.env.production")" "flag changed"
assert_contains 'up -d --no-deps --force-recreate backend' "$(cat "$root/docker.log")" "backend-only recreation"
if printf '%s\n' "$output" | grep -q 'never-print-this' ||
   grep -q 'never-print-this' "$root/stderr.log" "$root/logger.log" "$root/docker.log"; then
  printf 'FAIL: secret leaked to command output logs\n' >&2
  exit 1
fi

printf 'STAGE7_FINANCE_ENABLED=false\n' > "$root/current/.env.production"
run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE7_FINANCE_ENABLED true >/dev/null
assert_contains 'STAGE7_FINANCE_ENABLED=true' "$(cat "$root/current/.env.production")" "false to true"

printf 'UNRELATED=keep\n' > "$root/current/.env.production"
run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE8_TRACKER_ENABLED true >/dev/null
assert_contains 'STAGE8_TRACKER_ENABLED=true' "$(cat "$root/current/.env.production")" "absent flag appended"

for args in \
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa NOT_ALLOWED true' \
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE8_TRACKER_ENABLED TRUE' \
  'not-a-commit STAGE8_TRACKER_ENABLED true' \
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb STAGE8_TRACKER_ENABLED true'; do
  if run_flag "$root" set-feature-flag $args >/dev/null 2>&1; then
    printf 'FAIL: invalid input accepted: %s\n' "$args" >&2
    exit 1
  fi
done

printf 'STAGE8_TRACKER_ENABLED=true\nSTAGE8_TRACKER_ENABLED=false\n' > "$root/current/.env.production"
if run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE8_TRACKER_ENABLED true >/dev/null 2>&1; then
  printf 'FAIL: duplicate flag accepted\n' >&2
  exit 1
fi

root="$(new_fixture rollback)"
build_test_copy "$root" >/dev/null
printf 'SECRET=never-print-this\nSTAGE8_TILDA_ENABLED=false\n' > "$root/current/.env.production"
before="$(cat "$root/current/.env.production")"
export FAKE_CURL_FAIL_FIRST=1
if run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE8_TILDA_ENABLED true >/dev/null 2>&1; then
  printf 'FAIL: readiness failure accepted\n' >&2
  exit 1
fi
unset FAKE_CURL_FAIL_FIRST
assert_eq "$before" "$(cat "$root/current/.env.production")" "rollback restored env"
assert_eq 2 "$(grep -c 'up -d --no-deps --force-recreate backend' "$root/docker.log")" "rollback recreated backend"

root="$(new_fixture docker-failure)"
build_test_copy "$root" >/dev/null
printf 'SECRET=never-print-this\nSTAGE8_TILDA_ENABLED=false\n' > "$root/current/.env.production"
before="$(cat "$root/current/.env.production")"
export FAKE_DOCKER_FAIL_FIRST=1
if output="$(run_flag "$root" set-feature-flag aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STAGE8_TILDA_ENABLED true 2>"$root/stderr.log")"; then
  printf 'FAIL: Docker recreation failure accepted\n' >&2
  exit 1
fi
unset FAKE_DOCKER_FAIL_FIRST
assert_eq '' "$output" "Docker failure emits no success output"
assert_eq "$before" "$(cat "$root/current/.env.production")" "Docker failure rollback restored env"
assert_eq 2 "$(grep -c 'up -d --no-deps --force-recreate backend' "$root/docker.log")" "Docker failure attempted recovery recreation"
if grep -q 'FEATURE_FLAG_UPDATED' "$root/stderr.log" ||
   grep -q 'never-print-this' "$root/stderr.log" "$root/logger.log" "$root/docker.log"; then
  printf 'FAIL: Docker failure emitted success marker or secret\n' >&2
  exit 1
fi

root="$(new_fixture preflight)"
build_test_copy "$root" >/dev/null
cat > "$root/current/.env.production" <<'EOF'
SECRET=never-print-this
STAGE7_FINANCE_ENABLED=true
STAGE8_TRACKER_ENABLED=false
EOF
preflight_output="$(run_flag "$root" preflight)"
flag_lines="$(printf '%s\n' "$preflight_output" | grep -E '^(STAGE7_FINANCE_ENABLED|STAGE7_FINANCIAL_ACTIVATION_ENABLED|STAGE8_TRACKER_ENABLED|STAGE8_TILDA_ENABLED|STAGE8_ORDER_INGESTION_ENABLED|STAGE8_ATTRIBUTION_SHADOW_ENABLED|STAGE8_AUTO_ATTRIBUTION_ENABLED|STAGE8_FINANCE_HANDOFF_ENABLED)=(true|false|ABSENT)$')"
assert_eq 8 "$(printf '%s\n' "$flag_lines" | wc -l | tr -d ' ')" "preflight exposes eight flags"
if printf '%s\n' "$preflight_output" | grep -q 'never-print-this'; then
  printf 'FAIL: preflight leaked secret\n' >&2
  exit 1
fi

printf 'PASS: deployctl feature-flag tests\n'
