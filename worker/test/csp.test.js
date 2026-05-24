import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleRequest } from '../src/routes.js';
import { withSecurityHeaders, generateCspNonce, htmlCspWithNonce } from '../src/securityHeaders.js';
import { dbRun } from '../src/db.js';
import { renderPasswordPrompt } from '../src/routes/password.js';

async function ensureSchema() {
	await dbRun(
		env,
		`CREATE TABLE IF NOT EXISTS links (
			shortcode TEXT PRIMARY KEY, owner_id TEXT, url TEXT NOT NULL,
			description TEXT DEFAULT '', redirect_type INTEGER DEFAULT 301,
			tags TEXT DEFAULT '[]', archived INTEGER DEFAULT 0,
			activates_at TEXT, expires_at TEXT, password_hash TEXT,
			password_enabled INTEGER DEFAULT 0,
			created TEXT NOT NULL, updated TEXT NOT NULL,
			clicks INTEGER DEFAULT 0, last_clicked TEXT
		)`,
	);
	await dbRun(
		env,
		`CREATE TABLE IF NOT EXISTS counters (
			name TEXT PRIMARY KEY, value INTEGER DEFAULT 0, expires_at TEXT
		)`,
	);
}

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('CSP nonce primitives (B3)', () => {
	it('generateCspNonce returns a 32-char hex-ish string with no hyphens', () => {
		const a = generateCspNonce();
		const b = generateCspNonce();
		expect(a).toMatch(/^[0-9a-f]{32}$/);
		expect(b).toMatch(/^[0-9a-f]{32}$/);
		expect(a).not.toBe(b);
	});

	it('htmlCspWithNonce embeds the nonce in style-src and script-src and drops unsafe-inline', () => {
		const csp = htmlCspWithNonce('abc123');
		expect(csp).toContain("style-src 'self' 'nonce-abc123'");
		expect(csp).toContain("script-src 'self' 'nonce-abc123'");
		expect(csp).not.toContain("'unsafe-inline'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("base-uri 'self'");
	});

	it('withSecurityHeaders does NOT overwrite a Content-Security-Policy already on the response', async () => {
		const customCsp = htmlCspWithNonce('test-nonce-9');
		const original = new Response('<html></html>', {
			headers: {
				'Content-Type': 'text/html',
				'Content-Security-Policy': customCsp,
			},
		});
		const wrapped = withSecurityHeaders(env, new Request('http://localhost:8787/'), original);
		expect(wrapped.headers.get('Content-Security-Policy')).toBe(customCsp);
	});

	it('withSecurityHeaders applies the default (unsafe-inline) CSP when none is set (admin SPA path)', async () => {
		const original = new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
		const wrapped = withSecurityHeaders(env, new Request('http://localhost:8787/admin'), original);
		const csp = wrapped.headers.get('Content-Security-Policy');
		expect(csp).toContain("'unsafe-inline'");
	});
});

describe('renderPasswordPrompt nonce injection (B3)', () => {
	it('injects nonce into <style> and <script> tags', () => {
		const html = renderPasswordPrompt('demo', null, 'PWD-NONCE-XYZ');
		expect(html).toContain('<style nonce="PWD-NONCE-XYZ">');
		expect(html).toContain('<script nonce="PWD-NONCE-XYZ">');
		expect(html).not.toMatch(/<style>(?!\s*nonce)/);
		expect(html).not.toMatch(/<script>(?!\s*nonce)/);
	});

	it('renders the optional error message when provided', () => {
		const html = renderPasswordPrompt('demo', 'Bad password', 'N1');
		expect(html).toContain('Bad password');
	});
});

describe('Worker-rendered HTML responses set nonce-based CSP (B3)', () => {
	beforeEach(async () => {
		await ensureSchema();
		await dbRun(env, `DELETE FROM links`);
		await dbRun(env, `DELETE FROM counters`);
	});

	it('marketing homepage emits a nonce-based CSP matching the inline <style> nonce', async () => {
		// Use a non-localhost URL so the dev-bypass auth flow (mock user → 302 /admin)
		// doesn't intercept. We want the homepage HTML path here.
		const response = await handleRequest(
			new Request('https://link.mackhaymond.co/'),
			env,
			fakeLogger,
			null,
		);
		expect(response.status).toBe(200);
		const csp = response.headers.get('Content-Security-Policy');
		expect(csp).toBeTruthy();
		expect(csp).toMatch(/style-src 'self' 'nonce-[0-9a-f]{32}'/);
		expect(csp).toMatch(/script-src 'self' 'nonce-[0-9a-f]{32}'/);
		expect(csp).not.toContain("'unsafe-inline'");
		const nonceFromCsp = csp.match(/'nonce-([0-9a-f]{32})'/)[1];
		const html = await response.text();
		expect(html).toContain(`<style nonce="${nonceFromCsp}">`);
	});

	it('404 error page (unknown shortcode) emits a nonce-based CSP matching the inline <style> nonce', async () => {
		const response = await handleRequest(
			new Request('http://localhost:8787/this-does-not-exist'),
			env,
			fakeLogger,
			null,
		);
		expect(response.status).toBe(404);
		const csp = response.headers.get('Content-Security-Policy');
		expect(csp).toMatch(/style-src 'self' 'nonce-[0-9a-f]{32}'/);
		expect(csp).not.toContain("'unsafe-inline'");
		const nonceFromCsp = csp.match(/'nonce-([0-9a-f]{32})'/)[1];
		const html = await response.text();
		expect(html).toContain(`<style nonce="${nonceFromCsp}">`);
	});

	it('password prompt response (gated short link) emits a nonce-based CSP matching the inline tags', async () => {
		// Seed a password-protected link with a salt:hash that we won't try to verify
		// (we just want the path that returns the prompt, not the verifier path).
		const now = new Date().toISOString();
		await dbRun(
			env,
			`INSERT INTO links (shortcode, owner_id, url, password_hash, password_enabled, created, updated, clicks)
			 VALUES (?, ?, ?, ?, 1, ?, ?, 0)`,
			['gated', 'gh:owner', 'https://example.com', 'fakesalt:fakehash', now, now],
		);
		const response = await handleRequest(
			new Request('http://localhost:8787/gated'),
			env,
			fakeLogger,
			null,
		);
		expect(response.status).toBe(401);
		const csp = response.headers.get('Content-Security-Policy');
		expect(csp).toMatch(/style-src 'self' 'nonce-[0-9a-f]{32}'/);
		expect(csp).toMatch(/script-src 'self' 'nonce-[0-9a-f]{32}'/);
		expect(csp).not.toContain("'unsafe-inline'");
		const nonceFromCsp = csp.match(/'nonce-([0-9a-f]{32})'/)[1];
		const html = await response.text();
		expect(html).toContain(`<style nonce="${nonceFromCsp}">`);
		expect(html).toContain(`<script nonce="${nonceFromCsp}">`);
	});

	it('two successive requests get two distinct nonces (no nonce reuse)', async () => {
		const r1 = await handleRequest(new Request('https://link.mackhaymond.co/'), env, fakeLogger, null);
		const r2 = await handleRequest(new Request('https://link.mackhaymond.co/'), env, fakeLogger, null);
		const n1 = r1.headers.get('Content-Security-Policy').match(/'nonce-([0-9a-f]{32})'/)[1];
		const n2 = r2.headers.get('Content-Security-Policy').match(/'nonce-([0-9a-f]{32})'/)[1];
		expect(n1).not.toBe(n2);
	});
});
