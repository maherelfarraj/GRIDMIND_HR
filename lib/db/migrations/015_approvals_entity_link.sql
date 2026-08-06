-- Add queryable entity link columns to the approvals table so lookups
-- can use an index instead of scanning all rows and JSON-parsing metadata.
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS entity_id integer;

CREATE INDEX IF NOT EXISTS approvals_entity_idx ON approvals (entity_type, entity_id);

-- Backfill existing leave rows from the metadata JSON blob.
-- A PL/pgSQL loop with per-row exception handling ensures that a single
-- malformed metadata value (e.g. "{bad") never aborts the whole migration;
-- the bad row is simply left unlinked and can be fixed later.
DO $$
DECLARE
  r         RECORD;
  parsed    JSONB;
  leave_id  INT;
BEGIN
  FOR r IN
    SELECT id, metadata
    FROM   approvals
    WHERE  type     = 'leave'
      AND  metadata IS NOT NULL
      AND  entity_id IS NULL
  LOOP
    BEGIN
      parsed   := r.metadata::jsonb;
      leave_id := (parsed ->> 'leave_request_id')::integer;
      IF leave_id IS NOT NULL THEN
        UPDATE approvals
        SET    entity_type = 'leave_request',
               entity_id   = leave_id
        WHERE  id = r.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Malformed JSON or non-integer leave_request_id: skip this row silently.
      NULL;
    END;
  END LOOP;
END $$;
