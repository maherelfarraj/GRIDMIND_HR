-- Per-registration silent-gateway alarm window (minutes). NULL falls back to
-- the global default (GATEWAY_SILENCE_THRESHOLD_MINUTES env var, 10 minutes).
ALTER TABLE gateway_registrations
  ADD COLUMN IF NOT EXISTS silence_threshold_minutes integer;
