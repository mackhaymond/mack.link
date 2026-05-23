-- H16/H17: Add indexes that improve common query paths.
-- (CHECK constraints for analytics_* and links.redirect_type are NOT applied
-- here because SQLite can't ADD CHECK to existing tables and a rebuild on
-- the analytics tables risks data loss on a busy prod DB. They are enforced
-- at the application layer in validation.js. Defer the table rebuild to a
-- maintenance window if/when needed.)

CREATE INDEX IF NOT EXISTS idx_links_created ON links(created);
CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_links_archived ON links(archived) WHERE archived = 1;
CREATE INDEX IF NOT EXISTS idx_analytics_agg_scope_key ON analytics_agg(scope, key);
CREATE INDEX IF NOT EXISTS idx_analytics_day_agg_scope_dimension_day ON analytics_day_agg(scope, dimension, day);
