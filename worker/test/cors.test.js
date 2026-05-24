import { describe, it, expect } from 'vitest';
import { getCorsHeaders, isOriginAllowed } from '../src/cors.js';

function makeReq(url, headers = {}) {
	const h = new Map(Object.entries(headers));
	return {
		url,
		headers: { get: (k) => h.get(k) ?? null },
	};
}

describe('CORS', () => {
	const prodEnv = { ALLOWED_ORIGINS: 'https://app.example.com' };
	const devEnv = { AUTH_DISABLED: 'true', ENVIRONMENT: 'development', ALLOWED_ORIGINS: '' };

	describe('isOriginAllowed', () => {
		it('always allows the canonical prod origin', () => {
			expect(isOriginAllowed(prodEnv, 'https://link.mackhaymond.co')).toBe(true);
		});
		it('allows origins from ALLOWED_ORIGINS', () => {
			expect(isOriginAllowed(prodEnv, 'https://app.example.com')).toBe(true);
		});
		it('rejects unknown origins in prod', () => {
			expect(isOriginAllowed(prodEnv, 'https://evil.example.com')).toBe(false);
		});
		it('allows localhost only in dev bypass mode', () => {
			expect(isOriginAllowed(devEnv, 'http://localhost:5173')).toBe(true);
			expect(isOriginAllowed(prodEnv, 'http://localhost:5173')).toBe(false);
		});
		it('rejects empty/missing origins', () => {
			expect(isOriginAllowed(prodEnv, '')).toBe(false);
			expect(isOriginAllowed(prodEnv, null)).toBe(false);
		});
	});

	describe('getCorsHeaders', () => {
		it('omits ACAO header entirely for unknown origins', () => {
			const req = makeReq('https://link.mackhaymond.co/api/links', { Origin: 'https://evil.com' });
			const headers = getCorsHeaders(prodEnv, req);
			expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
			expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
		});

		it('echoes the Origin only when on the allow-list', () => {
			const req = makeReq('https://link.mackhaymond.co/api/links', { Origin: 'https://app.example.com' });
			const headers = getCorsHeaders(prodEnv, req);
			expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
			expect(headers['Access-Control-Allow-Credentials']).toBe('true');
		});

		it('never returns "*" with credentials', () => {
			const req = makeReq('https://link.mackhaymond.co/api/links', { Origin: 'https://evil.com' });
			const headers = getCorsHeaders(prodEnv, req);
			for (const v of Object.values(headers)) {
				if (v === '*') throw new Error('wildcard ACAO must not be returned');
			}
		});

		it('returns no headers at all for /admin/* (same-origin)', () => {
			const req = makeReq('https://link.mackhaymond.co/admin', { Origin: 'https://link.mackhaymond.co' });
			expect(getCorsHeaders(prodEnv, req)).toEqual({});
		});
	});

});
