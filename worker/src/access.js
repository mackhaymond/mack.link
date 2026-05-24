// Cloudflare Access JWT verification.
//
// Every request that traverses a Cloudflare Access application gets a
// `Cf-Access-Jwt-Assertion` header inserted before it reaches the origin
// Worker. The header is an RS256-signed JWT with claims (`iss`, `aud`,
// `email`, `sub`, `exp`, `nbf`, optionally `name`/`identity_nonce`).
// Verifying the signature against the team's JWKS proves the request
// genuinely came from Access and not from someone bypassing it (e.g. by
// hitting the workers.dev backend URL directly).
//
// Spec + reference implementation:
//   https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//   https://github.com/cloudflare/pages-plugins/tree/main/packages/cloudflare-access
//
// This file uses zero npm deps (Web Crypto + atob only) so it's tiny in
// the Worker bundle and trivial to audit. The JWKS is cached per-isolate
// for 1 hour; Cloudflare rotates Access signing keys every 6 weeks and
// keeps prior keys valid for 7 days after rotation, so a 1h cache TTL is
// safe against rotation.

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = null;

function base64UrlDecode(s) {
	const normalized = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
	const padded = normalized + '==='.slice(0, (4 - (normalized.length % 4)) % 4);
	const bin = atob(padded);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function decodeJsonSegment(seg) {
	return JSON.parse(new TextDecoder().decode(base64UrlDecode(seg)));
}

async function getJwks(teamDomain) {
	if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
		return jwksCache.keys;
	}
	const url = `${teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
	const body = await res.json();
	const keys = Array.isArray(body?.keys) ? body.keys : null;
	if (!keys) throw new Error('JWKS payload missing `keys` array');
	jwksCache = { keys, fetchedAt: Date.now() };
	return keys;
}

/**
 * Verify a Cloudflare Access JWT.
 *
 * @param {string} token - the raw `Cf-Access-Jwt-Assertion` header value
 * @param {string} teamDomain - https://<team>.cloudflareaccess.com (no trailing slash needed)
 * @param {string} policyAud - the Access application's AUD tag (from the dashboard)
 * @returns {Promise<object>} the verified payload (email, sub, name, etc.)
 * @throws {Error} on any failure (malformed, signature invalid, expired, wrong iss/aud, ...).
 *                 Callers in authenticateRequest catch and treat any throw as "unauthenticated".
 */
export async function verifyAccessJwt(token, teamDomain, policyAud) {
	if (!token || typeof token !== 'string') throw new Error('missing token');
	if (!teamDomain) throw new Error('missing teamDomain');
	if (!policyAud) throw new Error('missing policyAud');

	const parts = token.split('.');
	if (parts.length !== 3) throw new Error('malformed jwt');
	const [headerB64, payloadB64, sigB64] = parts;

	const header = decodeJsonSegment(headerB64);
	if (header.alg !== 'RS256') throw new Error(`unsupported alg: ${header.alg}`);
	if (!header.kid) throw new Error('missing kid');

	const keys = await getJwks(teamDomain);
	const jwk = keys.find((k) => k.kid === header.kid);
	if (!jwk) throw new Error(`kid not found in JWKS: ${header.kid}`);

	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const valid = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		base64UrlDecode(sigB64),
		new TextEncoder().encode(`${headerB64}.${payloadB64}`),
	);
	if (!valid) throw new Error('signature invalid');

	const payload = decodeJsonSegment(payloadB64);
	const now = Math.floor(Date.now() / 1000);

	const expectedIss = teamDomain.replace(/\/+$/, '');
	const actualIss = String(payload.iss || '').replace(/\/+$/, '');
	if (actualIss !== expectedIss) throw new Error(`iss mismatch: ${payload.iss}`);

	// Per RFC 7519 and CF Access spec, `aud` MAY be a string or array. CF
	// Access always emits an array but defensively accept both.
	const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
	if (auds.length === 0) throw new Error('missing aud');
	if (!auds.includes(policyAud)) throw new Error('aud mismatch');

	if (typeof payload.exp === 'number' && now >= payload.exp) throw new Error('expired');
	if (typeof payload.nbf === 'number' && now < payload.nbf) throw new Error('nbf in future');

	return payload;
}

// Exposed for tests only - reset the per-isolate JWKS cache so each test
// can stub a different fake JWKS via vi.spyOn(globalThis, 'fetch').
export function _resetJwksCacheForTests() {
	jwksCache = null;
}
