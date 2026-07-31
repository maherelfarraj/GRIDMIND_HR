-- Idempotent migration: device_commands (remote device command queue).
-- Applied automatically at api-server startup (src/lib/startupMigrations.ts)
-- and safe to run repeatedly against any environment.
-- Convention note: drizzle-kit push is unsafe in this project (it proposes
-- dropping the live connect-pg-simple `session` table), so schema changes are
-- shipped as targeted idempotent SQL and verified by the schema-drift tests.

CREATE TABLE IF NOT EXISTS device_commands (
  id serial PRIMARY KEY,
  device_id integer NOT NULL REFERENCES attendance_devices(id),
  registration_id integer NOT NULL REFERENCES gateway_registrations(id),
  command varchar(30) NOT NULL DEFAULT 'RESTART',
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  requested_by_user_id integer REFERENCES system_users(id),
  result_message text,
  delivered_at timestamp,
  acknowledged_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Heartbeat delivery scans by (registration_id, status); UI feed by device.
CREATE INDEX IF NOT EXISTS device_commands_registration_status_idx
  ON device_commands (registration_id, status);
CREATE INDEX IF NOT EXISTS device_commands_device_created_idx
  ON device_commands (device_id, created_at DESC);
