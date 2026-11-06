CREATE TABLE IF NOT EXISTS licenses (
 id uuid PRIMARY KEY,
 key_hash text UNIQUE NOT NULL,
 label text NOT NULL,
 duration_days integer NOT NULL CHECK(duration_days BETWEEN 1 AND 3650),
 max_devices integer NOT NULL CHECK(max_devices BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 activated_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS devices (
 license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
 device_hash text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('pc','android','ios')),
 first_seen timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(license_id,device_hash)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket text PRIMARY KEY,
 hits integer NOT NULL,
 reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(reset_at);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS encrypted_key text;
