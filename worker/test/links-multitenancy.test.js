import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dbRun, dbAll } from '../src/db.js';

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
	await dbRun(
		env,
		`CREATE TABLE IF NOT EXISTS counters (
			name TEXT PRIMARY KEY,
			value INTEGER DEFAULT 0,
			expires_at TEXT
		)`,
	);
}



async function seedUser(id, login) {
	await dbRun(
		env,
		`INSERT OR REPLACE INTO users (id, github_login, email, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
		[id, login, Date.now(), Date.now()],
	);
}

async function seedLink(shortcode, ownerId) {
	const now = new Date().toISOString();
	await dbRun(
		env,
		`INSERT OR REPLACE INTO links (shortcode, owner_id, url, description, redirect_type, tags, archived, activates_at, expires_at, password_hash, password_enabled, created, updated, clicks, last_clicked) VALUES (?, ?, 'https://example.com', '', 301, '[]', 0, NULL, NULL, NULL, 0, ?, ?, 0, NULL)`,
		[shortcode, ownerId, now, now],
	);
}

describe('Multi-tenancy IDOR (C6)', () => {
	beforeEach(async () => {
		// Miniflare's vitest pool gives each test isolated D1 storage, so we
		// must (re)create the schema in every beforeEach rather than beforeAll.
		await ensureSchema();
	});

	it('users only see their own links via getAllLinks', async () => {
		await seedUser('gh:alice', 'alice');
		await seedUser('gh:bob', 'bob');
		await seedLink('alice-link', 'gh:alice');
		await seedLink('bob-link', 'gh:bob');

		const { getAllLinks } = await import('../src/routes/routesLinks.js');
		const req = new Request('http://localhost:8787/api/links');
		const res = await getAllLinks(env, req, 'gh:alice');
		const body = await res.json();
		expect(Object.keys(body)).toEqual(['alice-link']);
		expect(body['bob-link']).toBeUndefined();
	});

	it('updateLink on another user link returns 404', async () => {
		await seedUser('gh:alice', 'alice');
		await seedUser('gh:bob', 'bob');
		await seedLink('bob-link', 'gh:bob');

		const { updateLink } = await import('../src/routes/routesLinks.js');
		const req = new Request('http://localhost:8787/api/links/bob-link', {
			method: 'PUT',
			body: JSON.stringify({ url: 'https://attacker.example.com' }),
			headers: { 'Content-Type': 'application/json' },
		});
		const res = await updateLink(req, env, 'bob-link', 'gh:alice');
		expect(res.status).toBe(404);

		const rows = await dbAll(env, `SELECT url FROM links WHERE shortcode = ?`, ['bob-link']);
		expect(rows[0].url).toBe('https://example.com');
	});

	it('deleteLink on another user link returns 404 and leaves the row', async () => {
		await seedUser('gh:alice', 'alice');
		await seedUser('gh:bob', 'bob');
		await seedLink('bob-link', 'gh:bob');

		const { deleteLink } = await import('../src/routes/routesLinks.js');
		const req = new Request('http://localhost:8787/api/links/bob-link', { method: 'DELETE' });
		const res = await deleteLink(env, 'bob-link', req, 'gh:alice');
		expect(res.status).toBe(404);

		const rows = await dbAll(env, `SELECT shortcode FROM links WHERE shortcode = ?`, ['bob-link']);
		expect(rows.length).toBe(1);
	});

	it("bulkDeleteLinks only deletes the requester's links", async () => {
		await seedUser('gh:alice', 'alice');
		await seedUser('gh:bob', 'bob');
		await seedLink('alice-1', 'gh:alice');
		await seedLink('alice-2', 'gh:alice');
		await seedLink('bob-1', 'gh:bob');

		const { bulkDeleteLinks } = await import('../src/routes/routesLinks.js');
		const req = new Request('http://localhost:8787/api/links/bulk', {
			method: 'DELETE',
			body: JSON.stringify({ shortcodes: ['alice-1', 'bob-1'] }),
			headers: { 'Content-Type': 'application/json' },
		});
		const res = await bulkDeleteLinks(req, env, 'gh:alice');
		const body = await res.json();
		expect(body.results.deleted).toEqual(['alice-1']);
		expect(body.results.notFound).toContain('bob-1');

		const remaining = await dbAll(env, `SELECT shortcode FROM links ORDER BY shortcode`);
		expect(remaining.map((r) => r.shortcode)).toEqual(['alice-2', 'bob-1']);
	});
});
