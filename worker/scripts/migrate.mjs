#!/usr/bin/env node
/**
 * Migration runner for D1.
 *
 * Tracks applied migrations in a `migrations` table:
 *   CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)
 *
 * Each file in worker/src/migrations/<NNN>_*.sql is an idempotent migration.
 * The runner records each ID after success; subsequent runs skip already-applied
 * files. ALTER-style schema changes that SQLite can't express idempotently get
 * handled here via PRAGMA table_info() checks.
 *
 * Usage:
 *   node scripts/migrate.mjs --local    # against the local Miniflare D1
 *   node scripts/migrate.mjs --remote   # against production D1
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'src', 'migrations');
const DB_NAME = 'mack-link';

const flag = process.argv[2];
if (flag !== '--local' && flag !== '--remote') {
	console.error('Usage: migrate.mjs --local | --remote');
	process.exit(2);
}
const target = flag;

function wrangler(args) {
	const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'inherit'],
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`wrangler ${args.join(' ')} exited with ${result.status}`);
	}
	return result.stdout;
}

function execSql(sql) {
	const tmp = mkdtempSync(join(tmpdir(), 'mack-link-mig-'));
	const file = join(tmp, 'mig.sql');
	writeFileSync(file, sql);
	try {
		wrangler(['d1', 'execute', DB_NAME, target, '--file', file]);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

function execSqlJson(sql) {
	const tmp = mkdtempSync(join(tmpdir(), 'mack-link-mig-q-'));
	const file = join(tmp, 'q.sql');
	writeFileSync(file, sql);
	try {
		const out = wrangler(['d1', 'execute', DB_NAME, target, '--file', file, '--json']);
		try {
			return JSON.parse(out);
		} catch {
			return null;
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

function ensureMigrationsTable() {
	execSql(`CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
}

function appliedIds() {
	const result = execSqlJson(`SELECT id FROM migrations ORDER BY id ASC;`);
	const rows = (result?.[0]?.results) || [];
	return new Set(rows.map((r) => r.id));
}

function columnExists(table, column) {
	const result = execSqlJson(`PRAGMA table_info(${table});`);
	const rows = (result?.[0]?.results) || [];
	return rows.some((r) => r.name === column);
}

function maybeAddExpiresAtToCounters() {
	if (!columnExists('counters', 'expires_at')) {
		console.log('  + ALTER counters ADD COLUMN expires_at TEXT');
		execSql(`ALTER TABLE counters ADD COLUMN expires_at TEXT;`);
	} else {
		console.log('  · counters.expires_at already present');
	}
}

function maybeAddOwnerIdToLinks() {
	const authorizedUser = process.env.AUTHORIZED_USER || 'legacy';
	const ownerId = `gh:${authorizedUser}`;
	const now = Date.now();
	// Ensure users table exists before we INSERT into it.
	execSql(
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			github_login TEXT UNIQUE NOT NULL,
			email TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
	);
	if (!columnExists('links', 'owner_id')) {
		console.log(`  + ALTER links ADD COLUMN owner_id TEXT (backfill -> ${ownerId})`);
		// SQLite can't add NOT NULL without a default. We add as nullable,
		// backfill, then rely on application-layer enforcement + the index.
		execSql(`ALTER TABLE links ADD COLUMN owner_id TEXT;`);
		execSql(
			`INSERT OR IGNORE INTO users (id, github_login, email, created_at, updated_at)
			 VALUES ('${ownerId}', '${authorizedUser}', NULL, ${now}, ${now});`,
		);
		execSql(`UPDATE links SET owner_id = '${ownerId}' WHERE owner_id IS NULL;`);
	} else {
		console.log('  · links.owner_id already present');
	}
}

function maybeAddUniqueClicks() {
	for (const table of ['analytics_day', 'analytics_day_agg']) {
		if (!columnExists(table, 'unique_clicks')) {
			console.log(`  + ALTER ${table} ADD COLUMN unique_clicks INTEGER DEFAULT 0`);
			execSql(`ALTER TABLE ${table} ADD COLUMN unique_clicks INTEGER DEFAULT 0;`);
		} else {
			console.log(`  · ${table}.unique_clicks already present`);
		}
	}
}

const PROGRAMMATIC_STEPS = {
	'002_counters_expiry.sql': maybeAddExpiresAtToCounters,
	'003_owner_id.sql': maybeAddOwnerIdToLinks,
	'005_unique_visitors.sql': maybeAddUniqueClicks,
};

function main() {
	console.log(`Running migrations against ${target.replace('--', '')} D1`);
	ensureMigrationsTable();
	const applied = appliedIds();
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => /^\d{3}_.+\.sql$/.test(f))
		.sort();
	let ran = 0;
	for (const f of files) {
		if (applied.has(f)) {
			console.log(`= ${f} (already applied)`);
			continue;
		}
		console.log(`+ ${f}`);
		// Programmatic step runs FIRST so it can ALTER TABLE / add columns that
		// any subsequent SQL (e.g. partial indexes on the new column) depends on.
		const programmatic = PROGRAMMATIC_STEPS[f];
		if (programmatic) programmatic();
		const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
		if (sql.trim().length > 0) execSql(sql);
		execSql(`INSERT INTO migrations (id, applied_at) VALUES ('${f}', ${Date.now()});`);
		ran++;
	}
	console.log(`Done. ${ran} new, ${files.length - ran} already applied.`);
}

main();
