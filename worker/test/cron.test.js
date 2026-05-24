import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dbAll, dbRun } from '../src/db.js';
import { purgeExpiredLinks } from '../src/utils.js';

async function ensureLinksTable() {
	await dbRun(env, `CREATE TABLE IF NOT EXISTS links (
		shortcode TEXT PRIMARY KEY, owner_id TEXT, url TEXT NOT NULL,
		description TEXT DEFAULT '', redirect_type INTEGER DEFAULT 301,
		tags TEXT DEFAULT '[]', archived INTEGER DEFAULT 0,
		activates_at TEXT, expires_at TEXT, password_hash TEXT,
		password_enabled INTEGER DEFAULT 0,
		created TEXT NOT NULL, updated TEXT NOT NULL,
		clicks INTEGER DEFAULT 0, last_clicked TEXT
	)`);
}

async function seedLink({ shortcode, expires_at }) {
	const now = new Date().toISOString();
	await dbRun(
		env,
		`INSERT INTO links (shortcode, owner_id, url, expires_at, created, updated, clicks)
		 VALUES (?, ?, ?, ?, ?, ?, 0)`,
		[shortcode, 'gh:owner', 'https://example.com', expires_at, now, now],
	);
}

describe('purgeExpiredLinks (S2 cron)', () => {
	beforeEach(async () => {
		await ensureLinksTable();
		await dbRun(env, `DELETE FROM links`);
	});

	it('deletes links whose expires_at is in the past', async () => {
		const past = new Date(Date.now() - 24 * 3600_000).toISOString();
		await seedLink({ shortcode: 'expired-yesterday', expires_at: past });
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links`);
		expect(remaining.map((r) => r.shortcode)).not.toContain('expired-yesterday');
		expect(remaining.length).toBe(0);
	});

	it('preserves links where expires_at IS NULL (no TTL)', async () => {
		await seedLink({ shortcode: 'permanent', expires_at: null });
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links`);
		expect(remaining.map((r) => r.shortcode)).toContain('permanent');
	});

	it('preserves links where expires_at is in the future', async () => {
		const future = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
		await seedLink({ shortcode: 'expires-next-week', expires_at: future });
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links`);
		expect(remaining.map((r) => r.shortcode)).toContain('expires-next-week');
	});

	it('preserves links where expires_at is empty string (legacy admin UI rows)', async () => {
		await seedLink({ shortcode: 'legacy-empty', expires_at: '' });
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links`);
		expect(remaining.map((r) => r.shortcode)).toContain('legacy-empty');
	});

	it('handles mixed input correctly in a single run', async () => {
		const past = new Date(Date.now() - 3600_000).toISOString();
		const future = new Date(Date.now() + 3600_000).toISOString();
		await seedLink({ shortcode: 'past-1', expires_at: past });
		await seedLink({ shortcode: 'past-2', expires_at: past });
		await seedLink({ shortcode: 'future-1', expires_at: future });
		await seedLink({ shortcode: 'null-ttl', expires_at: null });
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links ORDER BY shortcode`);
		expect(remaining.map((r) => r.shortcode)).toEqual(['future-1', 'null-ttl']);
	});

	it('is idempotent (safe to run multiple times in a row)', async () => {
		const past = new Date(Date.now() - 3600_000).toISOString();
		await seedLink({ shortcode: 'expired', expires_at: past });
		await purgeExpiredLinks(env);
		await purgeExpiredLinks(env);
		await purgeExpiredLinks(env);
		const remaining = await dbAll(env, `SELECT shortcode FROM links`);
		expect(remaining.length).toBe(0);
	});
});
