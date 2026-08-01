-- Persisted "credential unusable — re-register" flag: set when the startup
-- sweep or request verification finds a gateway's encrypted credential
-- envelope undecryptable (tampering / lost pepper); cleared automatically
-- once the stored credential decrypts again (e.g. after re-registration).
ALTER TABLE gateway_registrations ADD COLUMN IF NOT EXISTS credential_unusable BOOLEAN NOT NULL DEFAULT FALSE;
