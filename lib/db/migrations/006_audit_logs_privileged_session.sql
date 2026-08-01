-- Tag audit-log writes with the actor's open privileged (break-glass)
-- session so reviewers see precise attribution instead of a time-window
-- guess. The BEFORE INSERT trigger covers every write site (routes, jobs,
-- transactions) without code changes, and matches on the row's created_at
-- so backdated rows are attributed to the window they belong to.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS privileged_session_id integer;

CREATE INDEX IF NOT EXISTS idx_audit_logs_privileged_session_id
  ON audit_logs (privileged_session_id)
  WHERE privileged_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION tag_audit_log_privileged_session() RETURNS trigger AS $$
BEGIN
  IF NEW.privileged_session_id IS NULL AND NEW.actor_user_id IS NOT NULL THEN
    SELECT ps.id INTO NEW.privileged_session_id
    FROM privileged_sessions ps
    WHERE ps.user_id = NEW.actor_user_id
      AND ps.started_at <= COALESCE(NEW.created_at, now())
      AND COALESCE(ps.ended_at, ps.scheduled_end_at) >= COALESCE(NEW.created_at, now())
    -- Prefer the most recently started session; when two grants start at the
    -- same instant (back-to-back or overlapping), the newer grant (higher id)
    -- wins deterministically instead of leaving the choice to plan order.
    ORDER BY ps.started_at DESC, ps.id DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_tag_privileged_session ON audit_logs;
CREATE TRIGGER trg_audit_logs_tag_privileged_session
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION tag_audit_log_privileged_session();
