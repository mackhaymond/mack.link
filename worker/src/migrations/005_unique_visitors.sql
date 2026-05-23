-- M1: per-day unique-visitor tracking. We add a small "fingerprints" table
-- keyed by (scope, day, fingerprint) where fingerprint = SHA-256(IP + UA + day).
-- The hash is one-way; no PII is stored. The redirect handler does an
-- INSERT OR IGNORE; if the row is new it also increments unique_clicks on
-- the matching analytics_day / analytics_day_agg rows.

CREATE TABLE IF NOT EXISTS visitor_fingerprints (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (scope, day, fingerprint)
);

-- unique_clicks columns: programmatic ALTER from the runner so we don't
-- error on re-runs.
