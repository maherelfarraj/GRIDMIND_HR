#!/usr/bin/env bash
# Combined regression check: runs every release-blocking test suite and
# exits non-zero if ANY suite fails. Runs all suites even when an early
# one fails, so a single run reports every problem.
#
# Suites:
#   1. API schema/OpenAPI drift tests (artifacts/api-server)
#      includes codegen-drift: verifies lib/api-client-react and lib/api-zod
#      generated sources are in sync with lib/api-spec/openapi.yaml
#   2. Mobile unit tests (artifacts/mobile)
#   3. Monorepo-wide TypeScript typecheck (libs + all packages)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=()

run_suite() {
  local name="$1"; shift
  echo ""
  echo "=============================================="
  echo "==> Running suite: $name"
  echo "=============================================="
  if "$@"; then
    echo "==> PASSED: $name"
  else
    echo "==> FAILED: $name"
    FAILED+=("$name")
  fi
}

if [ -n "${REPLIT_DEPLOYMENT:-}" ] || [ -n "${PUBLISH_BUILD:-}" ]; then
  # Publish builds run against the production database BEFORE its schema is
  # synced, so the live-DB schema-drift test would always fail (chicken-and-egg).
  # Run only the DB-independent OpenAPI drift test here; schema-drift still
  # runs in the dev regression workflow.
  echo "==> Publish build detected: skipping live-DB schema-drift test"
  run_suite "api-openapi-drift" \
    bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/openapi-drift.test.ts src/__tests__/codegen-drift.test.ts"
else
  run_suite "api-schema-drift" \
    bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/schema-drift.test.ts src/__tests__/openapi-drift.test.ts src/__tests__/codegen-drift.test.ts"
fi

run_suite "mobile-tests" \
  bash -c "cd '$ROOT/artifacts/mobile' && npx vitest run"

run_suite "typecheck" \
  bash -c "cd '$ROOT' && pnpm run typecheck"

echo ""
echo "=============================================="
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "REGRESSION CHECK FAILED — failing suites: ${FAILED[*]}"
  exit 1
fi
echo "REGRESSION CHECK PASSED — all suites green"
