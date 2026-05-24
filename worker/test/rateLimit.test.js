import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit, rateLimitResponse } from '../src/rateLimit.js';

const env = { ALLOWED_ORIGINS: 'http://localhost:8787' };

function fakeBinding(verdicts) {
	const queue = Array.isArray(verdicts) ? [...verdicts] : [];
	const limit = vi.fn(async () => ({ success: queue.length ? queue.shift() : true }));
	return { limit };
}

describe('checkRateLimit (B1)', () => {
	it('allows requests when binding returns success: true', async () => {
		const binding = fakeBinding([true]);
		const result = await checkRateLimit(binding, 'user-1');
		expect(result.allowed).toBe(true);
		expect(binding.limit).toHaveBeenCalledWith({ key: 'user-1' });
	});

	it('denies requests when binding returns success: false', async () => {
		const binding = fakeBinding([false]);
		const result = await checkRateLimit(binding, 'user-1');
		expect(result.allowed).toBe(false);
	});

	it('isolates counters by key: two different keys do not share state', async () => {
		const calls = [];
		const binding = {
			limit: vi.fn(async ({ key }) => {
				calls.push(key);
				return { success: true };
			}),
		};
		await checkRateLimit(binding, 'user-a');
		await checkRateLimit(binding, 'user-b');
		expect(calls).toEqual(['user-a', 'user-b']);
		expect(binding.limit).toHaveBeenCalledTimes(2);
	});

	it('fails OPEN when binding is undefined (missing in env)', async () => {
		const result = await checkRateLimit(undefined, 'user-1');
		expect(result.allowed).toBe(true);
		expect(result.fallback).toBe(true);
	});

	it('fails OPEN when binding has no .limit method', async () => {
		const result = await checkRateLimit({}, 'user-1');
		expect(result.allowed).toBe(true);
		expect(result.fallback).toBe(true);
	});

	it('fails OPEN when binding throws (defense-in-depth)', async () => {
		const binding = {
			limit: vi.fn(async () => {
				throw new Error('upstream rate-limit infra unavailable');
			}),
		};
		const result = await checkRateLimit(binding, 'user-1');
		expect(result.allowed).toBe(true);
		expect(result.fallback).toBe(true);
		expect(result.error).toMatch(/upstream/);
	});

	it('repeated denials stay denied (binding owns the window)', async () => {
		const binding = fakeBinding([false, false, false]);
		expect((await checkRateLimit(binding, 'k')).allowed).toBe(false);
		expect((await checkRateLimit(binding, 'k')).allowed).toBe(false);
		expect((await checkRateLimit(binding, 'k')).allowed).toBe(false);
	});
});

describe('rateLimitResponse (B1)', () => {
	function req(url = 'http://localhost:8787/api/links') {
		return new Request(url, { headers: { Origin: 'http://localhost:8787' } });
	}

	it('emits a 429 text/plain by default with the legacy message', async () => {
		const res = rateLimitResponse(env, req());
		expect(res.status).toBe(429);
		expect(await res.text()).toBe('Rate limit exceeded');
	});

	it('emits a 429 JSON envelope when json: true (mirrors legacy bulk-op shape)', async () => {
		const res = rateLimitResponse(env, req(), { json: true });
		expect(res.status).toBe(429);
		expect(res.headers.get('Content-Type')).toContain('application/json');
		const body = await res.json();
		expect(body.error).toBe('Rate limit exceeded');
	});

	it('honors a custom message (used by password-verify path)', async () => {
		const res = rateLimitResponse(env, req(), {
			json: true,
			message: 'Too many attempts. Please wait a minute and try again.',
		});
		const body = await res.json();
		expect(body.error).toMatch(/Too many attempts/);
	});

	it('echoes allow-listed Origin via CORS (matches the rest of the worker)', async () => {
		const res = rateLimitResponse(env, req());
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
	});
});
