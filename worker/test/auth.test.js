import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticateRequest, requireAuth, handleLogout } from '../src/auth.js';
import { _resetJwksCacheForTests } from '../src/access.js';
import { isDevBypassEligible, getConfig, getMockUser } from '../src/config.js';
import { TEAM_DOMAIN, POLICY_AUD, generateKeypair, buildJwks, mintJwt, stubJwksFetch } from './_helpers/access-fixture.js';

const PROD_ENV = { TEAM_DOMAIN, POLICY_AUD };
const DEV_ENV = { ...PROD_ENV, AUTH_DISABLED: 'true', ENVIRONMENT: 'development' };

function req(url, headers = {}) {
	return new Request(url, { headers });
}

describe('config helpers (Sprint 2a)', () => {
	describe('isDevBypassEligible', () => {
		it('requires both AUTH_DISABLED=true and ENVIRONMENT=development', () => {
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true', ENVIRONMENT: 'development' })).toBe(true);
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true' })).toBe(false);
			expect(isDevBypassEligible({ ENVIRONMENT: 'development' })).toBe(false);
			expect(isDevBypassEligible({ AUTH_DISABLED: 'true', ENVIRONMENT: 'production' })).toBe(false);
			expect(isDevBypassEligible({})).toBe(false);
		});
		it('is case-insensitive on values', () => {
			expect(isDevBypassEligible({ AUTH_DISABLED: 'TRUE', ENVIRONMENT: 'DEVELOPMENT' })).toBe(true);
		});
	});

	describe('getConfig', () => {
		it('parses ALLOWED_ORIGINS as a comma-separated list', () => {
			const cfg = getConfig({ ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com' });
			expect(cfg.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
		});
		it('no longer surfaces removed OAuth/JWT fields', () => {
			const cfg = getConfig({ JWT_SECRET: 'should-be-ignored', GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' });
			expect(cfg.jwtSecret).toBeUndefined();
			expect(cfg.githubClientId).toBeUndefined();
			expect(cfg.githubClientSecret).toBeUndefined();
			expect(cfg.allowedRedirectUris).toBeUndefined();
			expect(cfg.sessionCookieName).toBeUndefined();
		});
		it('B4a (Sprint 2b): no longer surfaces authorizedUser', () => {
			const cfg = getConfig({ AUTHORIZED_USER: 'should-be-ignored' });
			expect(cfg.authorizedUser).toBeUndefined();
		});
		it('B1 (Sprint 2b): no longer surfaces rateLimits (native binding owns it)', () => {
			const cfg = getConfig({});
			expect(cfg.rateLimits).toBeUndefined();
		});
	});

	describe('getMockUser', () => {
		it('returns an identity matching the Access JWT shape', () => {
			const u = getMockUser({});
			expect(u).toHaveProperty('login');
			expect(u).toHaveProperty('email');
			expect(u).toHaveProperty('id');
			expect(u).toHaveProperty('name');
			expect(u).toHaveProperty('avatar_url');
		});
		it('honors AUTH_DISABLED_USER_* overrides', () => {
			const u = getMockUser({ AUTH_DISABLED_USER_LOGIN: 'alice', AUTH_DISABLED_USER_NAME: 'Alice A.' });
			expect(u.login).toBe('alice');
			expect(u.name).toBe('Alice A.');
		});
	});
});

describe('authenticateRequest (Sprint 2a A1)', () => {
	let keypair;
	let stub;

	beforeEach(async () => {
		_resetJwksCacheForTests();
		keypair = await generateKeypair();
		stub = stubJwksFetch(buildJwks(keypair.publicJwk));
	});

	afterEach(() => {
		stub.restore();
		_resetJwksCacheForTests();
	});

	it('dev bypass: returns mock user when eligible AND host is localhost', async () => {
		const user = await authenticateRequest(DEV_ENV, req('http://localhost:8787/api/links'));
		expect(user).not.toBeNull();
		expect(user.login).toBe('ai-dev');
		expect(user.id).toBe('dev:ai-dev');
	});

	it('dev bypass: returns null when eligible but host is NOT localhost', async () => {
		// Build a Request whose Host header is NOT localhost. The URL itself
		// drives the Host header for new Request(); use a non-loopback URL
		// to simulate a request reaching a deployed worker.dev URL in dev mode.
		const r = req('https://attacker.example.com/api/links');
		const user = await authenticateRequest(DEV_ENV, r);
		expect(user).toBeNull();
	});

	it('dev bypass disabled in prod (no AUTH_DISABLED): requires JWT', async () => {
		const user = await authenticateRequest(PROD_ENV, req('http://localhost:8787/api/links'));
		expect(user).toBeNull();
	});

	it('B4b (Sprint 2b): login is the FULL email, not the local-part', async () => {
		const token = await mintJwt(keypair.privateKey, { email: 'mack.haymond@icloud.com', name: 'Mack H.', sub: 'access:42' });
		const user = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links', {
			'cf-access-jwt-assertion': token,
		}));
		expect(user).not.toBeNull();
		expect(user.email).toBe('mack.haymond@icloud.com');
		expect(user.login).toBe('mack.haymond@icloud.com');
		expect(user.name).toBe('Mack H.');
		expect(user.id).toBe('access:42');
	});

	it('B4b: plus-addressed emails round-trip without mangling', async () => {
		const token = await mintJwt(keypair.privateKey, { email: 'mack+test@icloud.com' });
		const user = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links', {
			'cf-access-jwt-assertion': token,
		}));
		expect(user.login).toBe('mack+test@icloud.com');
	});

	it('B4b: same local-part across different domains does NOT collide', async () => {
		const a = await mintJwt(keypair.privateKey, { email: 'mack@example.com', sub: 'a' });
		const b = await mintJwt(keypair.privateKey, { email: 'mack@other.com', sub: 'b' });
		const uA = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links', { 'cf-access-jwt-assertion': a }));
		const uB = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links', { 'cf-access-jwt-assertion': b }));
		expect(uA.login).toBe('mack@example.com');
		expect(uB.login).toBe('mack@other.com');
		expect(uA.login).not.toBe(uB.login);
	});

	it('returns null on invalid JWT (verify throws)', async () => {
		const user = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links', {
			'cf-access-jwt-assertion': 'totally.not.a-jwt',
		}));
		expect(user).toBeNull();
	});

	it('returns null when no header is present (no Worker session cookie fallback anymore)', async () => {
		const user = await authenticateRequest(PROD_ENV, req('https://link.mackhaymond.co/api/links'));
		expect(user).toBeNull();
	});
});

describe('requireAuth (contract preserved)', () => {
	let keypair;
	let stub;

	beforeEach(async () => {
		_resetJwksCacheForTests();
		keypair = await generateKeypair();
		stub = stubJwksFetch(buildJwks(keypair.publicJwk));
	});

	afterEach(() => {
		stub.restore();
		_resetJwksCacheForTests();
	});

	it('returns 401 Response when unauthenticated', async () => {
		const result = await requireAuth(PROD_ENV, req('https://link.mackhaymond.co/api/links'));
		expect(result).toBeInstanceOf(Response);
		expect(result.status).toBe(401);
	});

	it('returns the user object when authenticated', async () => {
		const token = await mintJwt(keypair.privateKey, { email: 'mack.haymond@icloud.com' });
		const result = await requireAuth(PROD_ENV, req('https://link.mackhaymond.co/api/links', {
			'cf-access-jwt-assertion': token,
		}));
		expect(result).not.toBeInstanceOf(Response);
		expect(result.login).toBe('mack.haymond@icloud.com');
	});

	it('B4a (Sprint 2b): any authenticated identity is accepted - Access is the source of truth', async () => {
		const token = await mintJwt(keypair.privateKey, { email: 'someone-else@example.com' });
		const result = await requireAuth(PROD_ENV, req('https://link.mackhaymond.co/api/links', {
			'cf-access-jwt-assertion': token,
		}));
		expect(result).not.toBeInstanceOf(Response);
		expect(result.login).toBe('someone-else@example.com');
	});

	it('dev bypass returns the mock user without auth', async () => {
		const result = await requireAuth(DEV_ENV, req('http://localhost:8787/api/links'));
		expect(result).not.toBeInstanceOf(Response);
		expect(result.login).toBe('ai-dev');
	});
});

describe('handleLogout (Sprint 2a A2)', () => {
	it('returns a JSON body with the Cloudflare Access logout URL', async () => {
		const res = await handleLogout(PROD_ENV, req('https://link.mackhaymond.co/api/auth/logout'));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.logout).toContain('/cdn-cgi/access/logout');
		expect(body.logout).toContain(TEAM_DOMAIN);
	});

	it('does not Set-Cookie anymore (no Worker session cookie to clear)', async () => {
		const res = await handleLogout(PROD_ENV, req('https://link.mackhaymond.co/api/auth/logout'));
		expect(res.headers.get('Set-Cookie')).toBeNull();
	});
});
