-- On-demand gateway connection test: admin sets the flag, the next heartbeat
-- carrying a fresh connection-test result clears it. Idempotent.
ALTER TABLE gateway_registrations
  ADD COLUMN IF NOT EXISTS conn_test_requested_at timestamp;
