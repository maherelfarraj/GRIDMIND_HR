-- Add CHECK constraints to enforce allowed enum values for severity and priority.
-- These complement the NOT NULL DEFAULT constraints from migration 016.

ALTER TABLE disciplinary_records
  DROP CONSTRAINT IF EXISTS disciplinary_records_severity_check,
  ADD CONSTRAINT disciplinary_records_severity_check
    CHECK (severity IN ('minor', 'moderate', 'major', 'gross_misconduct'));

ALTER TABLE job_requisitions
  DROP CONSTRAINT IF EXISTS job_requisitions_priority_check,
  ADD CONSTRAINT job_requisitions_priority_check
    CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
