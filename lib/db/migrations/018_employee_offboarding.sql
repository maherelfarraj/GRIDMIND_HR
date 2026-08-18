-- Employee offboarding and final-clearance workflow.
-- Tenant scoped, idempotent, and safe for offline/on-prem deployments.

CREATE TABLE IF NOT EXISTS employee_offboarding (
  id serial PRIMARY KEY,
  org_id integer NOT NULL,
  employee_id integer NOT NULL,
  separation_type varchar(30) NOT NULL,
  notice_date varchar(10),
  last_working_date varchar(10) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  completion_pct integer NOT NULL DEFAULT 0,
  hr_owner_user_id integer,
  manager_employee_id integer,
  reason text,
  eligible_for_rehire boolean,
  exit_interview_completed_at timestamp,
  final_settlement_completed_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT employee_offboarding_type_check CHECK (
    separation_type IN ('resignation', 'termination', 'retirement', 'contract_end', 'transfer', 'death', 'other')
  ),
  CONSTRAINT employee_offboarding_status_check CHECK (
    status IN ('draft', 'in_progress', 'blocked', 'completed', 'cancelled')
  ),
  CONSTRAINT employee_offboarding_completion_check CHECK (
    completion_pct BETWEEN 0 AND 100
  )
);

CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id serial PRIMARY KEY,
  offboarding_id integer NOT NULL,
  title_en varchar(300) NOT NULL,
  title_ar varchar(300) NOT NULL,
  owner_role varchar(30) NOT NULL DEFAULT 'hr',
  control_area varchar(30) NOT NULL DEFAULT 'general',
  due_date varchar(10),
  status varchar(20) NOT NULL DEFAULT 'pending',
  completed_at timestamp,
  completed_by_user_id integer,
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT offboarding_tasks_status_check CHECK (
    status IN ('pending', 'in_progress', 'completed', 'skipped', 'blocked')
  )
);

CREATE INDEX IF NOT EXISTS employee_offboarding_org_status_idx
  ON employee_offboarding (org_id, status);
CREATE INDEX IF NOT EXISTS employee_offboarding_employee_idx
  ON employee_offboarding (employee_id);
CREATE INDEX IF NOT EXISTS offboarding_tasks_parent_sort_idx
  ON offboarding_tasks (offboarding_id, sort_order);
