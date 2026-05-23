import { getConfig, requireJwtSecret } from './config.js';

// Minimal JWT HS256 implementation using Web Crypto
async function importKey(secret) {
	const enc = new TextEncoder();
	return await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

function base64urlEncode(bytes) {
	const str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
	return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlEncodeJSON(obj) {
	const json = JSON.stringify(obj);
	const str = btoa(unescape(encodeURIComponent(json)));
	return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecodeToString(b64url) {
	const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
	const pad = '='.repeat((4 - (b64.length % 4)) % 4);
	return decodeURIComponent(escape(atob(b64 + pad)));
}

export async function createSessionJwt(env, user) {
	const { sessionMaxAgeSeconds } = getConfig(env);
	const secret = requireJwtSecret(env);
	const header = { alg: 'HS256', typ: 'JWT' };
	const now = Math.floor(Date.now() / 1000);
	const payload = { sub: String(user.id), user, iat: now, exp: now + Number(sessionMaxAgeSeconds || 28800) };
	const headerB64 = base64urlEncodeJSON(header);
	const payloadB64 = base64urlEncodeJSON(payload);
	const key = await importKey(secret);
	const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
	const sig = await crypto.subtle.sign('HMAC', key, data);
	const sigB64 = base64urlEncode(sig);
	return `${headerB64}.${payloadB64}.${sigB64}`;
}

export async function verifySessionJwt(env, token) {
	try {
		const secret = requireJwtSecret(env);
		const [headerB64, payloadB64, sigB64] = token.split('.');
		if (!headerB64 || !payloadB64 || !sigB64) return null;
		const key = await importKey(secret);
		const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
		const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
		const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
		if (!valid) return null;
		const payloadStr = base64urlDecodeToString(payloadB64);
		const payload = JSON.parse(payloadStr);
		if (!payload || (payload.exp && Math.floor(Date.now() / 1000) > payload.exp)) return null;
		return payload.user || null;
	} catch {
		return null;
	}
}

export function buildSessionCookie(token, env) {
	const { sessionCookieName, sessionMaxAgeSeconds, allowInsecureCookies } = getConfig(env);
	const maxAge = Number(sessionMaxAgeSeconds || 28800);
	const secure = allowInsecureCookies ? '' : ' Secure;';
	const sameSite = allowInsecureCookies ? 'Lax' : 'Lax';
	return `${sessionCookieName || '__Host-link_session'}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly;${secure} SameSite=${sameSite}`;
}

export function clearSessionCookie(env) {
	const { sessionCookieName, allowInsecureCookies } = getConfig(env);
	const secure = allowInsecureCookies ? '' : ' Secure;';
	return `${sessionCookieName || '__Host-link_session'}=deleted; Max-Age=0; Path=/; HttpOnly;${secure} SameSite=Lax`;
}

export function clearOauthStateCookie(env) {
	const { allowInsecureCookies } = getConfig(env);
	const secure = allowInsecureCookies ? '' : ' Secure;';
	return `oauth_state=deleted; Max-Age=0; Path=/; HttpOnly;${secure} SameSite=Lax`;
}

export function parseCookies(cookieHeader) {
	const header = cookieHeader || '';
	const out = Object.fromEntries(header.split(/;\s*/).filter(Boolean).map(kv => {
		const idx = kv.indexOf('=');
		if (idx === -1) return [kv, ''];
		return [kv.slice(0, idx), kv.slice(idx + 1)];
	}));
	return out;
}
