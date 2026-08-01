-- Idempotent migration: recurring/one-time flag on pay_components.
-- Applied automatically at api-server startup (src/lib/startupMigrations.ts)
-- and safe to run repeatedly against any environment.
--
-- Recurring fixed components (monthly stipends) are prorated for partial
-- employment during payroll calculation; one-time payments are paid in full.
-- Existing components default to recurring, matching prior stipend semantics.
ALTER TABLE pay_components
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT true;
