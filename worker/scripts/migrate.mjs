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
 *
 * S3: Database name defaults to `mack-link` (prod) but is overridable via
 * the `D1_DATABASE_NAME` env var so the PR-preview CI job can target the
 * staging D1 (`mack-link-staging`) without forking the runner. Example:
 *   D1_DATABASE_NAME=mack-link-staging node scripts/migrate.mjs --remote
 *
 * The env-var approach was picked over `wrangler --env staging` flag
 * passthrough because (a) it's a single-line change, (b) wrangler resolves
 * `d1 execute <DATABASE>` account-wide rather than env-scoped, so the
 * positional arg is the actual selector regardless of --env, and (c) the
 * migrations table is account-wide too (per-DB).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'src', 'migrations');
const DB_NAME = process.env.D1_DATABASE_NAME || 'mack-link';

const flag = process.argv[2];
if (flag !== '--local' && flag !== '--remote') {
	console.error('Usage: migrate.mjs --local | --remote');
	process.exit(2);
}
const target = flag;

function wrangler(args, { allowFailure = false } = {}) {
	const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
	});
	if (!allowFailure && result.status !== 0) {
		// Surface stderr so the caller sees what went wrong, since we no longer inherit it.
		if (result.stderr) process.stderr.write(result.stderr);
		throw new Error(`wrangler ${args.join(' ')} exited with ${result.status}`);
	}
	return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

/**
 * `wrangler d1 execute --file --json --remote` prefixes stdout with progress
 * lines (`├ Checking if file needs uploading`, `🌀 Uploading <id>.sql`, etc.)
 * BEFORE the JSON payload. JSON.parse blows up on those. This helper finds
 * the first '[' or '{' and parses from there, falling back to null on truly
 * malformed output.
 */
function parseJsonLoose(raw) {
	if (!raw) return null;
	const idx = (() => {
		const a = raw.indexOf('[');
		const b = raw.indexOf('{');
		if (a === -1) return b;
		if (b === -1) return a;
		return Math.min(a, b);
	})();
	if (idx < 0) return null;
	try {
		return JSON.parse(raw.slice(idx));
	} catch {
		return null;
	}
}

function execSql(sql) {
	const tmp = mkdtempSync(join(tmpdir(), 'mack-link-mig-'));
	const file = join(tmp, 'mig.sql');
	writeFileSync(file, sql);
	try {
		const { stderr, status } = wrangler(['d1', 'execute', DB_NAME, target, '--file', file], {
			allowFailure: true,
		});
		if (status !== 0) {
			if (stderr) process.stderr.write(stderr);
			throw new Error(`wrangler d1 execute --file (status ${status})`);
		}
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

/**
 * Run a short query and parse the JSON result.
 *
 * Uses `--command` (not `--file`) on purpose: `--file --json --remote` emits
 * the upload-progress banner to stdout AND returns a multi-envelope JSON
 * (meta row + data rows), which breaks both `JSON.parse` and naive `[0]`
 * indexing. `--command` is banner-free and single-envelope.
 */
function execSqlJson(sql) {
	const { stdout } = wrangler(['d1', 'execute', DB_NAME, target, '--command', sql, '--json']);
	return parseJsonLoose(stdout);
}

/**
 * Run an idempotent ALTER. Treats "duplicate column" (column already exists)
 * as success so that the runner stays robust even if `columnExists` ever
 * disagrees with reality (e.g. a prior aborted run, or wrangler output
 * format drift).
 */
function execIdempotentAlter(sql) {
	const tmp = mkdtempSync(join(tmpdir(), 'mack-link-mig-alter-'));
	const file = join(tmp, 'mig.sql');
	writeFileSync(file, sql);
	try {
		const { stderr, status } = wrangler(['d1', 'execute', DB_NAME, target, '--file', file], {
			allowFailure: true,
		});
		if (status === 0) return;
		const msg = (stderr || '').toLowerCase();
		if (msg.includes('duplicate column name') || msg.includes('already exists')) {
			console.log('    · column already present (treating as success)');
			return;
		}
		if (stderr) process.stderr.write(stderr);
		throw new Error(`wrangler d1 execute --file (status ${status})`);
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
		execIdempotentAlter(`ALTER TABLE counters ADD COLUMN expires_at TEXT;`);
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
		execIdempotentAlter(`ALTER TABLE links ADD COLUMN owner_id TEXT;`);
		execSql(
			`INSERT OR IGNORE INTO users (id, github_login, email, created_at, updated_at)
			 VALUES ('${ownerId}', '${authorizedUser}', NULL, ${now}, ${now});`,
		);
		execSql(`UPDATE links SET owner_id = '${ownerId}' WHERE owner_id IS NULL;`);
	} else {
		// Still backfill any null rows in case a previous partial run left them.
		execSql(
			`INSERT OR IGNORE INTO users (id, github_login, email, created_at, updated_at)
			 VALUES ('${ownerId}', '${authorizedUser}', NULL, ${now}, ${now});`,
		);
		execSql(`UPDATE links SET owner_id = '${ownerId}' WHERE owner_id IS NULL;`);
		console.log('  · links.owner_id already present (backfill verified)');
	}
}

function maybeAddUniqueClicks() {
	for (const table of ['analytics_day', 'analytics_day_agg']) {
		if (!columnExists(table, 'unique_clicks')) {
			console.log(`  + ALTER ${table} ADD COLUMN unique_clicks INTEGER DEFAULT 0`);
			execIdempotentAlter(`ALTER TABLE ${table} ADD COLUMN unique_clicks INTEGER DEFAULT 0;`);
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
	console.log(`Running migrations against ${target.replace('--', '')} D1 [${DB_NAME}]`);
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
