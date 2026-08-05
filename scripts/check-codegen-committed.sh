#!/usr/bin/env bash
# check-codegen-committed.sh
#
# Verifies that committed generated API clients exactly match what orval would
# produce from the current openapi.yaml, including all post-processing steps.
#
# Checks:
#   - lib/api-client-react/src/generated/  (react-query client)
#   - lib/api-zod/src/generated/           (zod validators + TS types)
#   - lib/api-zod/src/index.ts             (static re-export rewritten by codegen)
#
# Strategy: regenerate into a temp dir using orval.check.config.ts, apply the
# same two string replacements that the real codegen script applies to
# api-zod/generated/api.ts, then byte-exact diff against committed sources.
# .spec-hash files are excluded (they encode spec identity, not generated content).
#
# Skippable: SKIP_CODEGEN_CHECK=1 bypasses the whole check (for fast local loops).
# This is intentionally slow — do not add it to the fast schema-drift suite.
#
# Fix when failing: run  pnpm --filter @workspace/api-spec run codegen  and
# commit the updated generated files.

set -uo pipefail

if [[ "${SKIP_CODEGEN_CHECK:-}" == "1" ]]; then
  echo "==> SKIP_CODEGEN_CHECK=1: skipping codegen-committed check"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "==> codegen-committed: checking generated API clients are up to date..."

# ── Temp dir with guaranteed cleanup on any exit ─────────────────────────────
TMPWORK="$(mktemp -d)"
cleanup() { rm -rf "$TMPWORK"; }
trap cleanup EXIT

TMPWORK_API_CLIENT="$TMPWORK/api-client-react"
TMPWORK_API_ZOD="$TMPWORK/api-zod"
mkdir -p "$TMPWORK_API_CLIENT" "$TMPWORK_API_ZOD"

# ── Step 1: seed custom-fetch.ts into the temp workspace ─────────────────────
# orval resolves the mutator import path relative to the output file location.
# The check config redirects mutator.path to $TMPWORK_API_CLIENT/custom-fetch.ts
# so the relative import generated into api.ts stays "../custom-fetch" — the
# same as in committed files.  This file must exist before orval runs.
cp "$ROOT/lib/api-client-react/src/custom-fetch.ts" \
   "$TMPWORK_API_CLIENT/custom-fetch.ts"

# ── Step 2: regenerate into temp dir ─────────────────────────────────────────
echo "==> Running orval (this takes ~30-60s)..."
export CODEGEN_CHECK_TMPDIR="$TMPWORK"
if ! (cd "$ROOT/lib/api-spec" && pnpm exec orval --config ./orval.check.config.ts); then
  echo ""
  echo "FAIL: orval exited non-zero during codegen-committed check."
  exit 1
fi

# ── Step 3: replicate zod post-processing ────────────────────────────────────
# The codegen script rewrites generated/api.ts in-place after orval runs.
# Must replicate exactly the same two global replacements:
#   zod.int()        → zod.number()
#   zod.looseObject( → zod.object(
ZOD_API_TMP="$TMPWORK_API_ZOD/generated/api.ts"
node -e "
const fs = require('fs');
const f = process.argv[1];
fs.writeFileSync(f,
  fs.readFileSync(f, 'utf8')
    .replace(/zod\\.int\\(\\)/g, 'zod.number()')
    .replace(/zod\\.looseObject\\(/g, 'zod.object(')
);
" "$ZOD_API_TMP"

# ── Step 4: verify lib/api-zod/src/index.ts ──────────────────────────────────
# The codegen script unconditionally overwrites index.ts with two static lines.
# Check that the committed file matches what codegen would write.
EXPECTED_INDEX='export * from "./generated/api";
export * from "./password";'
ACTUAL_INDEX="$(cat "$ROOT/lib/api-zod/src/index.ts")"
if [[ "$ACTUAL_INDEX" != "$EXPECTED_INDEX" ]]; then
  echo ""
  echo "FAIL: lib/api-zod/src/index.ts does not match what codegen would write."
  echo ""
  echo "--- expected ---"
  printf '%s\n' "$EXPECTED_INDEX"
  echo "--- actual ---"
  printf '%s\n' "$ACTUAL_INDEX"
  echo ""
  echo "Fix: run  pnpm --filter @workspace/api-spec run codegen  and commit the result."
  exit 1
fi
echo "==> lib/api-zod/src/index.ts: OK"

# ── Step 5: byte-exact diff of generated directories ─────────────────────────
# diff exits 0 = identical, 1 = differences, 2 = error.
# We exclude .spec-hash: it encodes the openapi.yaml hash (checked by the fast
# codegen-drift test), not generated-file content.
OVERALL_FAILED=0

diff_generated() {
  local label="$1"
  local committed_dir="$2"
  local tmp_dir="$3"

  echo ""
  echo "==> Diffing $label ..."
  # arg order: diff COMMITTED TMP
  #   lines starting with < are in committed but not in tmp (deleted lines)
  #   lines starting with > are in tmp but not in committed (new lines)
  #   "Only in <tmp>: file" = file was generated but never committed
  #   "Only in <committed>: file" = committed file was deleted from generated output
  if diff -r -u --exclude=".spec-hash" "$committed_dir" "$tmp_dir"; then
    echo "==> $label: MATCH"
  else
    echo ""
    echo "FAIL: $label differs from committed sources."
    echo "Fix: run  pnpm --filter @workspace/api-spec run codegen  and commit the result."
    OVERALL_FAILED=1
  fi
}

diff_generated \
  "lib/api-client-react/src/generated" \
  "$ROOT/lib/api-client-react/src/generated" \
  "$TMPWORK_API_CLIENT/generated"

diff_generated \
  "lib/api-zod/src/generated" \
  "$ROOT/lib/api-zod/src/generated" \
  "$TMPWORK_API_ZOD/generated"

echo ""
if [[ "$OVERALL_FAILED" -ne 0 ]]; then
  echo "==> codegen-committed check FAILED."
  exit 1
fi

echo "==> codegen-committed check PASSED — committed generated files are up to date."
