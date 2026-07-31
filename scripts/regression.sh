#!/usr/bin/env bash
# Combined regression check: runs every release-blocking test suite and
# exits non-zero if ANY suite fails. Runs all suites even when an early
# one fails, so a single run reports every problem.
#
# Suites:
#   1. API schema/OpenAPI drift tests (artifacts/api-server)
#   2. Mobile unit tests (artifacts/mobile)
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

run_suite "api-schema-drift" \
  bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/schema-drift.test.ts src/__tests__/openapi-drift.test.ts"

run_suite "mobile-tests" \
  bash -c "cd '$ROOT/artifacts/mobile' && npx vitest run"

echo ""
echo "=============================================="
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "REGRESSION CHECK FAILED — failing suites: ${FAILED[*]}"
  exit 1
fi
echo "REGRESSION CHECK PASSED — all suites green"
