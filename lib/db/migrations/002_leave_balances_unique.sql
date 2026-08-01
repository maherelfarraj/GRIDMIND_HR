-- Idempotent migration: unique index on leave_balances(employee_id, leave_type_id, year).
-- Applied automatically at api-server startup (src/lib/startupMigrations.ts)
-- and safe to run repeatedly against any environment.
--
-- Guards the auto-provisioning paths (ensureLeaveBalance, provision-year,
-- annual-reset) against concurrent inserts creating duplicate balance rows.
-- Any pre-existing duplicates are resolved deterministically before the index
-- is created: only the lowest-id row per (employee, type, year) is kept.
DELETE FROM leave_balances a
USING leave_balances b
WHERE a.employee_id = b.employee_id
  AND a.leave_type_id = b.leave_type_id
  AND a.year = b.year
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_emp_type_year_uq
  ON leave_balances (employee_id, leave_type_id, year);
