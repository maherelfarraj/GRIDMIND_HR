---
name: OpenAPI ↔ drizzle drift guard
description: Shrink-only baseline ratchet decision for the OpenAPI-vs-DB drift guard.
---
**Rule:** the guard comparing the hand-written OpenAPI spec to the drizzle tables freezes pre-existing drift in a shrink-only baseline; regeneration intersects with the committed baseline, so new drift can never be absorbed — it must be fixed in the spec or accepted via the curated allowlists for genuinely computed/omitted fields.

**Why:** the spec had drifted across ~100 schemas when the guard was introduced; a strict test would have required fixing them all up front, while the ratchet made CI green immediately yet strict for anything new.

**How to apply:** when a drift failure appears, fix the spec/schema — never widen the baseline; when fixing old drift, prune its baseline entry. Note: `schema-drift` is a validation command (validation skill), not a regular workflow — `configureWorkflow` changes to it silently don't persist; use `setValidationCommand`.

Update (Jul 2026): the baseline was burned down to empty — response schemas now match the tables, with genuinely joined/computed fields recorded in ALLOWED_EXTRA_PROPERTIES in the test. Gap: the guard only checks *response* component schemas; `*Input`/request-body schemas are NOT covered and several still carry legacy field names (e.g. JobRequisitionInput.title, CertificationInput.certName), so create/edit forms can send fields the server ignores.
