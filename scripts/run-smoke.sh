#!/usr/bin/env bash
# HRMS admin smoke suite runner.
#
# Prerequisites:
#   - 'artifacts/api-server: API Server' workflow running
#   - 'artifacts/hrms: web' workflow running
#   - At least one of the following env vars set to a working admin password
#     (tried in this order by global-setup.ts):
#       SMOKE_ADMIN_PASSWORD  — dedicated smoke credential (preferred)
#       ADMIN_RESET_PASSWORD  — operator-supplied reset password
#       DEMO_PILOT_PASSWORD   — dev seeding password
#
# mustChangePassword:
#   If login succeeds but the account has mustChangePassword=true, global-setup
#   FAILS with instructions.  No credentials are changed without explicit
#   opt-in (see below).
#
# Opt-in credential rotation (isolated dev/CI only):
#   SMOKE_ALLOW_PASSWORD_ROTATION=true SMOKE_ROTATION_PASSWORD=<new-pw> \
#     bash scripts/run-smoke.sh
#   This permits global-setup to call change-password on the admin account.
#   Guards: refused in production (NODE_ENV=production or REPLIT_DEPLOYMENT set).
#   After rotation, set SMOKE_ADMIN_PASSWORD=<SMOKE_ROTATION_PASSWORD value>
#   for subsequent runs so no further DB changes are needed.
#
# Runtime state:
#   global-setup writes scripts/smoke/auth.json (session cookie + localStorage).
#   This file is in .gitignore and must never be committed.
#
# Target URL:
#   SMOKE_BASE_URL — base URL of the HRMS app under test.
#   Defaults to http://localhost:80 (dev).
#   Set to the published URL for post-publish runs:
#     SMOKE_BASE_URL=https://enterprise-hr-suite.replit.app bash scripts/run-smoke.sh
#
# Usage:
#   bash scripts/run-smoke.sh             # run full suite (dev)
#   bash scripts/run-smoke.sh --headed    # show browser window (debug)
#   bash scripts/run-smoke.sh --grep "Pilot"  # run one test by name
#
# Run before/after any deployment or API change that touches admin routes.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SMOKE_DIR="$ROOT/scripts/smoke"

# ── 0. Target URL ─────────────────────────────────────────────────────────────
export SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://localhost:80}"
echo "==> Target: $SMOKE_BASE_URL"

# ── 1. Locate Chromium in the nix store ──────────────────────────────────────
# @playwright/test is pinned to 1.44.0 which expects chromium revision 1080,
# matching the nix store package below.  We skip Playwright's browser download
# (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1) because auto-fetched binaries cannot
# find their dynamic linker on NixOS.
NIX_CHROMIUM_KNOWN="/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome"

if [ -x "$NIX_CHROMIUM_KNOWN" ]; then
  PLAYWRIGHT_CHROMIUM_PATH="$NIX_CHROMIUM_KNOWN"
else
  # Fallback: glob the known prefix — faster than a full /nix/store traversal.
  PLAYWRIGHT_CHROMIUM_PATH="$(
    ls /nix/store/*playwright-browsers-chromium*/chromium-1080/chrome-linux/chrome 2>/dev/null | head -1
  )"
fi

if [ -z "$PLAYWRIGHT_CHROMIUM_PATH" ] || [ ! -x "$PLAYWRIGHT_CHROMIUM_PATH" ]; then
  echo "ERROR: Could not find Playwright Chromium revision-1080 binary in /nix/store." >&2
  echo "       Known path: $NIX_CHROMIUM_KNOWN" >&2
  echo "       If the nix store hash has changed, update NIX_CHROMIUM_KNOWN in this script." >&2
  exit 1
fi

export PLAYWRIGHT_CHROMIUM_PATH
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

echo "==> Chromium: $PLAYWRIGHT_CHROMIUM_PATH"

# ── 2. Install npm dependencies if needed ────────────────────────────────────
# scripts/smoke is NOT a pnpm workspace package — it stays outside the
# monorepo typecheck/build graph.
if [ ! -d "$SMOKE_DIR/node_modules/@playwright" ]; then
  echo "==> Installing smoke suite dependencies (npm install)…"
  (cd "$SMOKE_DIR" && npm install --no-audit --prefer-offline 2>&1)
fi

# ── 3. Run the suite ─────────────────────────────────────────────────────────
echo "==> Running HRMS admin smoke suite…"
echo ""
(cd "$SMOKE_DIR" && npx playwright test "$@")
