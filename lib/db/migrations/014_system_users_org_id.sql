-- Add home-org column to system_users. Idempotent: safe to re-run.
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS org_id integer;

-- Back-fill from the linked employee record for existing rows.
UPDATE system_users su
SET org_id = e.org_id
FROM employees e
WHERE su.employee_id = e.id
  AND su.org_id IS NULL;

-- Users with no employee link fall back to the default organisation.
UPDATE system_users
SET org_id = (SELECT id FROM organizations WHERE is_default = true LIMIT 1)
WHERE org_id IS NULL;
