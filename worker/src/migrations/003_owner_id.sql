-- C6: multi-tenancy. The runner's programmatic step creates the `users`
-- table and adds `links.owner_id` (PRAGMA-gated ALTER + backfill). This
-- SQL only creates the supporting index, which is safe to run repeatedly
-- and only succeeds once the column exists.

CREATE INDEX IF NOT EXISTS idx_links_owner_shortcode ON links(owner_id, shortcode);
