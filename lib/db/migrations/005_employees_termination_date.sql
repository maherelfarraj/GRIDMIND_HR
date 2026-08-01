-- Idempotent migration: explicit last working day on the employee record.
-- Applied automatically at api-server startup (src/lib/startupMigrations.ts)
-- and safe to run repeatedly against any environment.
--
-- HR records a first-class offboarding date on employees; payroll proration
-- prefers this over contract-derived termination dates, and status
-- transitions (active -> terminated) are tied to it.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS termination_date text;
