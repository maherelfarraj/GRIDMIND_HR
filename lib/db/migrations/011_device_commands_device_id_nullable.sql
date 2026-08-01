-- RECONCILE commands target a gateway registration, not a specific device,
-- so device_id becomes nullable. DROP NOT NULL is idempotent.
ALTER TABLE device_commands ALTER COLUMN device_id DROP NOT NULL;
