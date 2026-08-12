#!/usr/bin/env bash
# Capture a fresh login-page screenshot and save it to screenshots/login.jpg.
#
# This script mirrors the Chromium-resolution approach used by run-smoke.sh so
# both suites share the same nix-store binary.  It does NOT need the API server
# or the database — the HRMS frontend alone is sufficient (the login form
# renders without any API call when no session exists in localStorage).
#
# Prerequisites:
#   - 'artifacts/hrms: web' workflow running  (or SCREENSHOT_BASE_URL set to
#     wherever the frontend is reachable)
#
# Usage:
#   bash scripts/capture-login-screenshot.sh
#   SCREENSHOT_BASE_URL=http://localhost:4173 bash scripts/capture-login-screenshot.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="$ROOT/scripts/screenshot"

# ── 0. Target URL ─────────────────────────────────────────────────────────────
export SCREENSHOT_BASE_URL="${SCREENSHOT_BASE_URL:-http://localhost:80}"
echo "==> Target: $SCREENSHOT_BASE_URL"

# ── 1. Locate Chromium in the nix store ──────────────────────────────────────
# Matches the same binary used by run-smoke.sh.
NIX_CHROMIUM_KNOWN="/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome"

if [ -x "$NIX_CHROMIUM_KNOWN" ]; then
  PLAYWRIGHT_CHROMIUM_PATH="$NIX_CHROMIUM_KNOWN"
else
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
if [ ! -d "$SCREENSHOT_DIR/node_modules/@playwright" ]; then
  echo "==> Installing screenshot suite dependencies (npm install)…"
  (cd "$SCREENSHOT_DIR" && npm install --no-audit --prefer-offline 2>&1)
fi

# ── 3. Capture the screenshot ─────────────────────────────────────────────────
echo "==> Capturing login-page screenshot…"
echo ""
(cd "$SCREENSHOT_DIR" && npx playwright test "$@")

echo ""
echo "==> Done. Screenshot saved to screenshots/login.jpg"
