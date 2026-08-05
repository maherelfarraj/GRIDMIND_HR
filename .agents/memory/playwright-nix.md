---
name: Playwright on Nix
description: Running Playwright headless tests in this Nix environment, and credential safety for smoke suites.
---
Playwright's downloaded browsers don't run on NixOS; use the Chromium already present in the nix store via `executablePath`, and pin the Playwright version to one whose expected Chromium revision matches that binary.
**Why:** NixOS lacks the FHS libraries Playwright's bundled Chromium expects; mismatched revisions can break the protocol.
**How to apply:** Resolve the binary path at runtime (globbing, not a full /nix/store find — that times out). Keep browser-test tooling outside the pnpm workspace so it skips monorepo typecheck/build.
Credential safety: smoke suites must never commit session/auth state (gitignore runtime storageState), never embed passwords in source, and never silently rotate credentials — rotation requires an explicit opt-in flag, a caller-supplied secret, and a non-production guard.
