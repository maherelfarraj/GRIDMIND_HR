-- Add severity to disciplinary_records and priority to job_requisitions. Idempotent: safe to re-run.
ALTER TABLE disciplinary_records ADD COLUMN IF NOT EXISTS severity varchar(30) NOT NULL DEFAULT 'minor';
ALTER TABLE job_requisitions ADD COLUMN IF NOT EXISTS priority varchar(20) NOT NULL DEFAULT 'medium';
