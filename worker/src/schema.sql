-- D1 schema for mack.link
-- For fresh installs; existing deployments should use `npm run db:apply` which
-- invokes the JS migration runner instead.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_login TEXT UNIQUE NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  shortcode TEXT PRIMARY KEY,
  owner_id TEXT,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  redirect_type INTEGER DEFAULT 301,
  tags TEXT DEFAULT '[]',
  archived INTEGER DEFAULT 0,
  activates_at TEXT,
  expires_at TEXT,
  password_hash TEXT,
  password_enabled INTEGER DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  last_clicked TEXT
);

CREATE INDEX IF NOT EXISTS idx_links_owner_shortcode ON links(owner_id, shortcode);

-- Profile (single row with id=1)
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT 'Mack Haymond',
  description TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  theme TEXT DEFAULT 'default',
  background_type TEXT DEFAULT 'gradient',
  background_value TEXT DEFAULT 'blue-purple',
  is_active INTEGER DEFAULT 1,
  custom_css TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ensure default profile row exists
INSERT OR IGNORE INTO profile (
  id, title, description, avatar_url, theme, background_type, background_value, is_active, custom_css, created_at, updated_at
) VALUES (
  1, 'Mack Haymond', 'Software Developer & Creator', '', 'default', 'gradient', 'blue-purple', 1, '', datetime('now'), datetime('now')
);

-- Profile links
CREATE TABLE IF NOT EXISTS profile_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT DEFAULT '',
  order_index INTEGER NOT NULL,
  is_visible INTEGER DEFAULT 1,
  click_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Analytics totals per day per scope (shortcode or '_all')
CREATE TABLE IF NOT EXISTS analytics_day (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  PRIMARY KEY (scope, day)
);

-- Analytics breakdown aggregated (overall)
CREATE TABLE IF NOT EXISTS analytics_agg (
  scope TEXT NOT NULL,
  dimension TEXT NOT NULL,
  key TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  PRIMARY KEY (scope, dimension, key)
);

-- Analytics breakdown per day
CREATE TABLE IF NOT EXISTS analytics_day_agg (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  dimension TEXT NOT NULL,
  key TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  PRIMARY KEY (scope, day, dimension, key)
);

-- Global counters (expires_at supports ephemeral entries for rate limiting and password sessions)
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER DEFAULT 0,
  expires_at TEXT
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_analytics_day_scope_day ON analytics_day(scope, day);
CREATE INDEX IF NOT EXISTS idx_analytics_agg_scope_dimension ON analytics_agg(scope, dimension);
CREATE INDEX IF NOT EXISTS idx_analytics_day_agg_scope_day_dimension ON analytics_day_agg(scope, day, dimension);
CREATE INDEX IF NOT EXISTS idx_links_archived_created ON links(archived, created);
CREATE INDEX IF NOT EXISTS idx_links_clicks ON links(clicks);
CREATE INDEX IF NOT EXISTS idx_profile_links_order ON profile_links(order_index);
CREATE INDEX IF NOT EXISTS idx_profile_links_visible ON profile_links(is_visible);
CREATE INDEX IF NOT EXISTS idx_counters_expires_at ON counters(expires_at) WHERE expires_at IS NOT NULL;
