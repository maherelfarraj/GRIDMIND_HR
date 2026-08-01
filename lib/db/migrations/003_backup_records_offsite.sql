-- Idempotent migration: offsite replication columns on backup_records.
-- Applied automatically at api-server startup (src/lib/startupMigrations.ts)
-- and safe to run repeatedly against any environment.
--
-- Backfills the deployment path for the offsite-backup feature: the columns
-- exist in the Drizzle schema and application code but had no committed
-- migration, so upgraded databases would fail with undefined-column errors.
ALTER TABLE backup_records
  ADD COLUMN IF NOT EXISTS offsite_location varchar(500),
  ADD COLUMN IF NOT EXISTS offsite_status varchar(20),
  ADD COLUMN IF NOT EXISTS offsite_error text,
  ADD COLUMN IF NOT EXISTS offsite_uploaded_at timestamp;
