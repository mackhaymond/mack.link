import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dbAll, dbGet, dbRun } from '../src/db.js';

async function ensureSchema() {
	await dbRun(env, `CREATE TABLE IF NOT EXISTS links (
		shortcode TEXT PRIMARY KEY, owner_id TEXT, url TEXT NOT NULL,
		description TEXT DEFAULT '', redirect_type INTEGER DEFAULT 301,
		tags TEXT DEFAULT '[]', archived INTEGER DEFAULT 0,
		activates_at TEXT, expires_at TEXT, password_hash TEXT,
		password_enabled INTEGER DEFAULT 0,
		created TEXT NOT NULL, updated TEXT NOT NULL,
		clicks INTEGER DEFAULT 0, last_clicked TEXT
	)`);
	await dbRun(env, `CREATE TABLE IF NOT EXISTS analytics_day (
		scope TEXT NOT NULL, day TEXT NOT NULL, clicks INTEGER DEFAULT 0,
		PRIMARY KEY (scope, day)
	)`);
	await dbRun(env, `CREATE TABLE IF NOT EXISTS analytics_agg (
		scope TEXT NOT NULL, dimension TEXT NOT NULL, key TEXT NOT NULL,
		clicks INTEGER DEFAULT 0, PRIMARY KEY (scope, dimension, key)
	)`);
	await dbRun(env, `CREATE TABLE IF NOT EXISTS analytics_day_agg (
		scope TEXT NOT NULL, day TEXT NOT NULL, dimension TEXT NOT NULL,
		key TEXT NOT NULL, clicks INTEGER DEFAULT 0,
		PRIMARY KEY (scope, day, dimension, key)
	)`);
	await dbRun(env, `CREATE TABLE IF NOT EXISTS counters (
		name TEXT PRIMARY KEY, value INTEGER DEFAULT 0, expires_at TEXT
	)`);
}

async function seedLink(shortcode) {
	const now = new Date().toISOString();
	await dbRun(
		env,
		`INSERT INTO links (shortcode, owner_id, url, created, updated, clicks) VALUES (?, ?, ?, ?, ?, 0)`,
		[shortcode, 'gh:owner', 'https://example.com', now, now],
	);
}

function buildRequest(url, headers = {}) {
	return new Request(url, { headers });
}

describe('Redirect handler (C8, C9, M17)', () => {
	beforeEach(async () => {
		await ensureSchema();
		await dbRun(env, `DELETE FROM links`);
		await dbRun(env, `DELETE FROM analytics_day`);
		await dbRun(env, `DELETE FROM analytics_agg`);
		await dbRun(env, `DELETE FROM analytics_day_agg`);
		await dbRun(env, `DELETE FROM counters`);
	});

	it('atomic click increment under concurrent requests (C8)', async () => {
		await seedLink('race');
		const { handleRedirect } = await import('../src/routes/redirect.js');
		const fakeLogger = { info: () => {}, error: () => {} };
		// 25 parallel "click" requests - the final clicks counter must equal 25
		await Promise.all(
			Array.from({ length: 25 }, () =>
				handleRedirect(
					buildRequest('http://localhost:8787/race', { 'User-Agent': 'Mozilla/5.0' }),
					env,
					fakeLogger,
					null,
				),
			),
		);
		const row = await dbGet(env, `SELECT clicks FROM links WHERE shortcode = ?`, ['race']);
		expect(row.clicks).toBe(25);
	});

	it('prefetch requests are redirected but do not increment clicks (C9)', async () => {
		await seedLink('pref');
		const { handleRedirect } = await import('../src/routes/redirect.js');
		const fakeLogger = { info: () => {}, error: () => {} };
		const prefetchHeaders = [
			{ 'Sec-Purpose': 'prefetch', 'User-Agent': 'Mozilla/5.0' },
			{ 'Sec-Fetch-Dest': 'prefetch', 'User-Agent': 'Mozilla/5.0' },
			{ 'Purpose': 'prefetch', 'User-Agent': 'Mozilla/5.0' },
			{ 'X-Moz': 'prefetch', 'User-Agent': 'Mozilla/5.0' },
			{ 'X-Purpose': 'prefetch', 'User-Agent': 'Mozilla/5.0' },
		];
		for (const h of prefetchHeaders) {
			const res = await handleRedirect(
				buildRequest('http://localhost:8787/pref', h),
				env,
				fakeLogger,
				null,
			);
			expect(res.status).toBe(301);
		}
		const row = await dbGet(env, `SELECT clicks FROM links WHERE shortcode = ?`, ['pref']);
		expect(row.clicks).toBe(0);
		const analyticsRows = await dbAll(env, `SELECT * FROM analytics_day WHERE scope = ?`, ['pref']);
		expect(analyticsRows.length).toBe(0);
	});

	it('bot UA is redirected but not counted (C9 - existing behavior, regression test)', async () => {
		await seedLink('bot');
		const { handleRedirect } = await import('../src/routes/redirect.js');
		const fakeLogger = { info: () => {}, error: () => {} };
		const res = await handleRedirect(
			buildRequest('http://localhost:8787/bot', { 'User-Agent': 'Googlebot/2.1' }),
			env,
			fakeLogger,
			null,
		);
		expect(res.status).toBe(301);
		const row = await dbGet(env, `SELECT clicks FROM links WHERE shortcode = ?`, ['bot']);
		expect(row.clicks).toBe(0);
	});

	it('real user request DOES count and write analytics', async () => {
		await seedLink('user');
		const { handleRedirect } = await import('../src/routes/redirect.js');
		const fakeLogger = { info: () => {}, error: () => {} };
		await handleRedirect(
			buildRequest('http://localhost:8787/user', { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
			env,
			fakeLogger,
			null,
		);
		const row = await dbGet(env, `SELECT clicks FROM links WHERE shortcode = ?`, ['user']);
		expect(row.clicks).toBe(1);
		const analyticsRows = await dbAll(env, `SELECT * FROM analytics_day WHERE scope = ?`, ['user']);
		expect(analyticsRows.length).toBeGreaterThan(0);
	});
});
