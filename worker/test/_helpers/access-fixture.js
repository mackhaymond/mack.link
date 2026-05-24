// Shared fixture for Cloudflare Access JWT tests.
//
// Generates an RSASSA-PKCS1-v1_5 (RS256) keypair via Web Crypto in-process,
// then helps tests mint signed JWTs with arbitrary claims + serve a matching
// JWKS via a stubbed global fetch. Zero external deps - keeps the same
// audit-friendly property as the access.js implementation itself.

export const TEAM_DOMAIN = 'https://test-team.cloudflareaccess.com';
export const POLICY_AUD = 'abc123def456';
export const TEST_KID = 'test-key-1';

function base64urlFromBytes(bytes) {
	const bin = String.fromCharCode(...new Uint8Array(bytes));
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlFromJson(obj) {
	const json = JSON.stringify(obj);
	const bin = unescape(encodeURIComponent(json));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return base64urlFromBytes(bytes);
}

export async function generateKeypair() {
	const { publicKey, privateKey } = await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	);
	const publicJwk = await crypto.subtle.exportKey('jwk', publicKey);
	publicJwk.kid = TEST_KID;
	publicJwk.alg = 'RS256';
	publicJwk.use = 'sig';
	return { privateKey, publicKey, publicJwk };
}

export function buildJwks(publicJwk) {
	return { keys: [publicJwk] };
}

export async function mintJwt(privateKey, { iss = TEAM_DOMAIN, aud = [POLICY_AUD], email = 'user@example.com', name = 'Test User', sub = 'sub-test-1', exp, nbf, kid = TEST_KID, ttlSeconds = 600, extraClaims = {} } = {}) {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'RS256', typ: 'JWT', kid };
	const payload = {
		iss,
		aud,
		email,
		name,
		sub,
		iat: now,
		exp: typeof exp === 'number' ? exp : now + ttlSeconds,
		...(typeof nbf === 'number' ? { nbf } : {}),
		...extraClaims,
	};
	const headerB64 = base64urlFromJson(header);
	const payloadB64 = base64urlFromJson(payload);
	const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
	const sigB64 = base64urlFromBytes(sig);
	return `${headerB64}.${payloadB64}.${sigB64}`;
}

/**
 * Stub globalThis.fetch so any call to `<teamDomain>/cdn-cgi/access/certs`
 * returns the provided JWKS. Other fetches throw to surface accidental
 * network use during tests. Returns a counter object so tests can assert
 * cache behavior (number of JWKS fetches).
 *
 * Usage:
 *   const { restore, counter } = stubJwksFetch(jwks, TEAM_DOMAIN);
 *   // ...test...
 *   restore();
 *   expect(counter.calls).toBe(1);
 */
export function stubJwksFetch(jwks, teamDomain = TEAM_DOMAIN) {
	const originalFetch = globalThis.fetch;
	const certsUrl = `${teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`;
	const counter = { calls: 0 };
	globalThis.fetch = async (input, _init) => {
		const url = typeof input === 'string' ? input : input.url;
		if (url === certsUrl) {
			counter.calls++;
			return new Response(JSON.stringify(jwks), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		throw new Error(`unexpected fetch in test: ${url}`);
	};
	return {
		counter,
		restore: () => {
			globalThis.fetch = originalFetch;
		},
	};
}
