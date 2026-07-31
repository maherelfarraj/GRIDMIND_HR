---
name: Auth-mode fail-closed convention
description: Session auth is on by default; only an explicit PILOT_AUTH="false" disables it, dev-only.
---
Rule: session auth in the API is enforced by default. The only opt-out is explicitly setting `PILOT_AUTH="false"`; unset, misspelled, or any other value means enforced. Production refuses to start with auth disabled; elsewhere a loud warning is logged. The flag must never be defaulted-off by scripts or workflows — the developer has to set it themselves for demo mode.

**Why:** the flag originally worked the other way (`PILOT_AUTH === "true"` enabled auth), so a missing or typo'd env var in a production deploy silently disabled all authentication; a review also rejected a dev script that auto-supplied the opt-out.

**How to apply:** read the auth mode dynamically at request time (tests toggle env per-suite), never gate new security checks on truthy opt-in flags, and never bake `PILOT_AUTH=false` into launch scripts.
