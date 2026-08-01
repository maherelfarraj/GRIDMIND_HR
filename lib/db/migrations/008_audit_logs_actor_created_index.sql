-- Composite index supporting GET /privileged-sessions/:id/activity's
-- time-window fallback: both the page query and the COUNT filter audit_logs
-- by actor_user_id and a created_at range. Without it, both degrade to
-- sequential scans as the audit trail grows to millions of rows.
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON audit_logs (actor_user_id, created_at);
