-- Multi-org tenant scoping: add org_id to the core HR tables.
-- Existing rows are backfilled to the deployment's actual default organization
-- (is_default = true, falling back to the lowest org id) rather than assuming
-- an id. public_holidays.org_id stays nullable: NULL = global/legacy holiday
-- visible to every org. Idempotent; safe to re-run.

ALTER TABLE employees          ADD COLUMN IF NOT EXISTS org_id integer NOT NULL DEFAULT 1;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS org_id integer NOT NULL DEFAULT 1;
ALTER TABLE payroll_periods    ADD COLUMN IF NOT EXISTS org_id integer NOT NULL DEFAULT 1;
ALTER TABLE leave_requests     ADD COLUMN IF NOT EXISTS org_id integer NOT NULL DEFAULT 1;
ALTER TABLE leave_balances     ADD COLUMN IF NOT EXISTS org_id integer NOT NULL DEFAULT 1;
ALTER TABLE public_holidays    ADD COLUMN IF NOT EXISTS org_id integer;

-- Re-point any row whose org_id does not reference a real organization (the
-- ADD COLUMN default above, or a deleted org) at the actual default org.
DO $$
DECLARE
  def_org integer;
BEGIN
  SELECT id INTO def_org FROM organizations WHERE is_default = true ORDER BY id LIMIT 1;
  IF def_org IS NULL THEN
    SELECT id INTO def_org FROM organizations ORDER BY id LIMIT 1;
  END IF;
  IF def_org IS NULL THEN
    RETURN; -- no organizations yet; defaults stand until orgs are seeded
  END IF;

  UPDATE employees          SET org_id = def_org WHERE org_id NOT IN (SELECT id FROM organizations);
  UPDATE attendance_records SET org_id = def_org WHERE org_id NOT IN (SELECT id FROM organizations);
  UPDATE payroll_periods    SET org_id = def_org WHERE org_id NOT IN (SELECT id FROM organizations);
  UPDATE leave_requests     SET org_id = def_org WHERE org_id NOT IN (SELECT id FROM organizations);
  UPDATE leave_balances     SET org_id = def_org WHERE org_id NOT IN (SELECT id FROM organizations);
  UPDATE public_holidays    SET org_id = def_org WHERE org_id IS NOT NULL AND org_id NOT IN (SELECT id FROM organizations);

  -- Future inserts without an explicit org land in the default org.
  EXECUTE format('ALTER TABLE employees          ALTER COLUMN org_id SET DEFAULT %s', def_org);
  EXECUTE format('ALTER TABLE attendance_records ALTER COLUMN org_id SET DEFAULT %s', def_org);
  EXECUTE format('ALTER TABLE payroll_periods    ALTER COLUMN org_id SET DEFAULT %s', def_org);
  EXECUTE format('ALTER TABLE leave_requests     ALTER COLUMN org_id SET DEFAULT %s', def_org);
  EXECUTE format('ALTER TABLE leave_balances     ALTER COLUMN org_id SET DEFAULT %s', def_org);
END $$;
