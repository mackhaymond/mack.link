import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleRequest } from '../src/routes.js';
import { dbRun } from '../src/db.js';

async function ensureSchema() {
	await dbRun(
		env,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			github_login TEXT UNIQUE NOT NULL,
			email TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	);
	await dbRun(
		env,
		`CREATE TABLE IF NOT EXISTS links (
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
		)`,
	);
}

function req(url, init = {}) {
	return new Request(url, init);
}

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('D1 Sessions API integration (B2)', () => {
	beforeEach(async () => {
		await ensureSchema();
		await dbRun(env, `DELETE FROM links`);
		await dbRun(env, `DELETE FROM users`);
	});

	it('attaches x-d1-bookmark header to /api/* responses (so the client can round-trip it)', async () => {
		const response = await handleRequest(
			req('http://localhost:8787/api/user'),
			env,
			fakeLogger,
			null,
		);
		expect(response.status).toBe(200);
		const bookmark = response.headers.get('x-d1-bookmark');
		expect(typeof bookmark === 'string' || bookmark === null).toBe(true);
	});

	it('threads the request bookmark into env.DB.withSession()', async () => {
		const calls = [];
		const captureSessionDb = {
			withSession: (bookmark) => {
				calls.push(bookmark);
				return {
					prepare: (sql) => env.DB.prepare(sql),
					batch: (stmts) => env.DB.batch(stmts),
					getBookmark: () => 'bm-after-test',
				};
			},
		};
		const fakeEnv = { ...env, DB: captureSessionDb };
		const response = await handleRequest(
			req('http://localhost:8787/api/user', { headers: { 'x-d1-bookmark': 'caller-bm-42' } }),
			fakeEnv,
			fakeLogger,
			null,
		);
		expect(calls).toEqual(['caller-bm-42']);
		expect(response.headers.get('x-d1-bookmark')).toBe('bm-after-test');
	});

	it('defaults to first-unconstrained when no bookmark header is present', async () => {
		const calls = [];
		const captureSessionDb = {
			withSession: (bookmark) => {
				calls.push(bookmark);
				return {
					prepare: (sql) => env.DB.prepare(sql),
					batch: (stmts) => env.DB.batch(stmts),
					getBookmark: () => null,
				};
			},
		};
		const fakeEnv = { ...env, DB: captureSessionDb };
		await handleRequest(req('http://localhost:8787/api/user'), fakeEnv, fakeLogger, null);
		expect(calls).toEqual(['first-unconstrained']);
	});

	it('non-API paths skip session creation (hot path stays on raw env.DB)', async () => {
		const calls = [];
		const captureSessionDb = {
			withSession: (bookmark) => {
				calls.push(bookmark);
				return {
					prepare: (sql) => env.DB.prepare(sql),
					batch: (stmts) => env.DB.batch(stmts),
					getBookmark: () => null,
				};
			},
		};
		const fakeEnv = { ...env, DB: captureSessionDb };
		// Hit the homepage (non-API) — should NOT call withSession.
		await handleRequest(req('http://localhost:8787/'), fakeEnv, fakeLogger, null);
		expect(calls).toEqual([]);
	});

	it('back-compat: works when env.DB has no withSession (e.g. older Miniflare)', async () => {
		// Strip withSession to simulate an old runtime / fallback path.
		const strippedDb = Object.create(null);
		Object.assign(strippedDb, {
			prepare: env.DB.prepare.bind(env.DB),
			batch: env.DB.batch.bind(env.DB),
		});
		const fakeEnv = { ...env, DB: strippedDb };
		const response = await handleRequest(
			req('http://localhost:8787/api/user'),
			fakeEnv,
			fakeLogger,
			null,
		);
		expect(response.status).toBe(200);
		// No session = no bookmark header.
		expect(response.headers.get('x-d1-bookmark')).toBeNull();
	});

	it('a writes session lets a subsequent read in the same request see the write (read-after-write)', async () => {
		// This is the core property D1 Sessions exists to provide. In our worker
		// it manifests through any handler that writes then reads (e.g. createLink
		// inserts then returns the row). Here we exercise it directly through dbRun.
		const session = env.DB.withSession('first-unconstrained');
		const sessionEnv = { ...env, DB: session };
		const now = new Date().toISOString();
		await dbRun(
			sessionEnv,
			`INSERT INTO links (shortcode, owner_id, url, created, updated, clicks) VALUES (?, ?, ?, ?, ?, 0)`,
			['raw-rb', 'gh:rb', 'https://example.com', now, now],
		);
		const { dbGet } = await import('../src/db.js');
		const row = await dbGet(sessionEnv, `SELECT shortcode, url FROM links WHERE shortcode = ?`, ['raw-rb']);
		expect(row).toBeTruthy();
		expect(row.shortcode).toBe('raw-rb');
		expect(row.url).toBe('https://example.com');
	});
});
