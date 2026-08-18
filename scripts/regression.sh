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

# Rebuild all composite shared libraries (lib/db, lib/api-zod, etc.) before any
# suite runs.  Without this, a schema edit that hasn't been manually compiled
# will silently leave lib/db/dist stale and break the API-server typecheck even
# though the source change is correct.  tsc --build is incremental, so this is
# fast when nothing changed.
echo "==> Rebuilding shared libs (tsc --build)…"
if ! (cd "$ROOT" && pnpm run typecheck:libs); then
  echo "==> FATAL: shared-lib build failed; aborting regression run"
  exit 1
fi

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
elif [ -z "${DATABASE_URL:-}" ]; then
  # Local clones and lightweight review environments often have no Postgres
  # instance. Keep all static contract checks active and skip only the test
  # that actually queries information_schema. CI and configured development
  # environments still run the complete live-schema comparison.
  echo "==> DATABASE_URL is not set: skipping live-DB schema-drift test"
  run_suite "api-static-drift" \
    bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/openapi-drift.test.ts src/__tests__/codegen-drift.test.ts"
else
  run_suite "api-schema-drift" \
    bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/schema-drift.test.ts src/__tests__/openapi-drift.test.ts src/__tests__/codegen-drift.test.ts"
fi

# Auth-coverage guard: static + runtime check that every /admin/* route is
# protected by requireAuth.  The static layer (source analysis) has no DB
# dependency and runs in all environments including publish builds.  The
# runtime layer (unauthenticated HTTP probes) also requires no DB because
# requireAuth blocks the request before any DB query is made.
run_suite "api-auth-coverage" \
  bash -c "cd '$ROOT/artifacts/api-server' && npx vitest run src/__tests__/auth-coverage.test.ts"

if [[ "${SKIP_CODEGEN_CHECK:-}" == "1" ]]; then
  echo ""
  echo "==> SKIP_CODEGEN_CHECK=1: skipping codegen-committed suite"
else
  run_suite "codegen-committed" \
    bash -c "'$ROOT/scripts/check-codegen-committed.sh'"
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
