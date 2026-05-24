-- counters.expires_at is added by the JS runner (010-migrate.mjs) which
-- does a PRAGMA table_info() check before issuing ALTER TABLE. This file
-- only ensures the supporting index exists; it is safe to run repeatedly
-- and works whether the column is added by the runner or already present
-- from a fresh 001 build.

CREATE INDEX IF NOT EXISTS idx_counters_expires_at
  ON counters(expires_at) WHERE expires_at IS NOT NULL;
