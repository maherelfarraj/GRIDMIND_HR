---
name: Real backup & restore testing
description: How real pg_dump backups and scratch-DB restore tests work in this environment.
---
The managed Postgres here allows `CREATE DATABASE` / `DROP DATABASE ... WITH (FORCE)`, so restore tests restore a custom-format pg_dump into a throwaway scratch database on the same server, verify row counts vs the live source, then drop it.

**Why:** avoids schema-remap hacks; pg_restore of custom dumps can't easily retarget a schema.

**How to apply:** backup logic lives in the api-server backup service; dumps go to `BACKUP_DIR` (default `<cwd>/backups`, gitignored). Row-count checks allow a small tolerance on append-only tables (audit_logs, backup_records) because the source drifts during the test. A passing restore test marks the backup verified, which feeds the DATA_BACKUP_VERIFIED and DATA_RESTORE_TESTED go-live gates.
