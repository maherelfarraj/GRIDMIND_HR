---
name: Input-schema drift guard
description: Request-body *Input/*Update OpenAPI schemas are drift-checked against drizzle columns; how to handle renames and handler-mapped fields.
---

Request-body (`*Input`/`*Update`) OpenAPI schemas are drift-guarded against drizzle columns, same as response schemas; handler-mapped exceptions go in a curated allowlist with a comment citing the handler.

**Why:** most route handlers insert/update the request body wholesale and drizzle silently discards unknown keys, so a stale spec field means user-typed data vanishes without an error.

**How to apply:** when adding a form field, ensure the column exists and the Input schema uses the exact column key; after spec edits, regenerate the API client and let typecheck surface payload fixes. Never leave a UI input on a form whose value has no column/mapping — remove the widget instead of silently dropping it.
