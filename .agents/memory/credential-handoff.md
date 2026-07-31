---
name: Credential handoff to operators
description: Security principles for generated credentials (one-time passwords, tokens) delivered to operators.
---

Principles:
- Generated credentials must never enter the application log stream — logs feed aggregation/retention readable by many people.
- Persist the operator handoff before committing the credential, and block serving traffic until hardening succeeds; a failure must leave accounts fail-closed, never behind an unknown password.
- Treat handoff + commit as a recoverable workflow: verify handoff entries against live state at startup and prune anything that no longer matches, so crashes and concurrent provisioners self-heal.
- Security hardening must not depend on an optional env var being set; gate one-time passes with a persisted marker instead.

**Why:** each of these was a review-blocking security finding in this project's production credential provisioning.
