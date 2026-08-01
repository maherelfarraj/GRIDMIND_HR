-- Exactly-once device-command outcome notifications across restarts.
-- outcome_notified_at is an atomic claim: the writer that sets it (from NULL)
-- is the only one allowed to insert the notification, so the deferred
-- request-path write and the startup/periodic backfill sweep can never
-- double-notify. Idempotent; safe to re-run.
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS outcome_notified_at timestamp;

-- Backfill: commands whose notification already exists are marked claimed so
-- the first backfill sweep after this deploy does not duplicate them.
UPDATE device_commands dc
SET outcome_notified_at = now()
WHERE dc.outcome_notified_at IS NULL
  AND EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.entity_type = 'device_command'
      AND n.entity_id = dc.id
      AND n.notification_type = 'device_command_outcome'
  );
