import { getConfig, isDevBypassEligible } from './config.js';

/**
 * Always-allowed prod origin. Add additional production origins via the
 * ALLOWED_ORIGINS env var (comma-separated).
 */
const ALWAYS_ALLOWED_PROD = ['https://link.mackhaymond.co'];

/**
 * Localhost origins are only auto-allowed in dev bypass mode.
 */
const LOCAL_DEV_ORIGINS = [
	'http://localhost:5173',
	'http://localhost:8787',
	'http://127.0.0.1:5173',
	'http://127.0.0.1:8787',
];

function buildAllowList(env) {
	const cfg = getConfig(env);
	const list = new Set([...ALWAYS_ALLOWED_PROD, ...(cfg.allowedOrigins || [])]);
	if (isDevBypassEligible(env)) {
		for (const o of LOCAL_DEV_ORIGINS) list.add(o);
	}
	return list;
}

/**
 * Returns true if the given origin string is allowed for CORS.
 * Exported for use in OAuth flows (C4).
 */
export function isOriginAllowed(env, origin) {
	if (!origin) return false;
	return buildAllowList(env).has(origin);
}

/**
 * Returns true if a redirect_uri is allowed.
 * Allows exact matches from ALLOWED_REDIRECT_URIS, and any URI whose origin
 * is on the CORS allow-list (so that e.g. /admin/auth/callback paths work
 * without listing every callback variant).
 */
export function isRedirectUriAllowed(env, redirectUri) {
	if (!redirectUri || typeof redirectUri !== 'string') return false;
	const { allowedRedirectUris } = getConfig(env);
	if (allowedRedirectUris.includes(redirectUri)) return true;
	let url;
	try {
		url = new URL(redirectUri);
	} catch {
		return false;
	}
	if (!/^https?:$/.test(url.protocol)) return false;
	return isOriginAllowed(env, url.origin);
}

/**
 * Build CORS headers for a given request.
 * Returns {} for same-origin admin routes (no CORS needed).
 * For API routes, only echoes the Origin header back if it's on the allow-list.
 * NEVER returns '*' alongside Access-Control-Allow-Credentials.
 */
export function getCorsHeaders(env, request) {
	if (!request) return {};

	const url = new URL(request.url);
	if (url.pathname.startsWith('/admin')) return {};

	const requestOrigin = request.headers?.get?.('Origin') || '';

	const baseHeaders = {
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-dev-auth',
		'Access-Control-Max-Age': '600',
		Vary: 'Origin',
	};

	if (requestOrigin && isOriginAllowed(env, requestOrigin)) {
		return {
			...baseHeaders,
			'Access-Control-Allow-Origin': requestOrigin,
			'Access-Control-Allow-Credentials': 'true',
		};
	}

	return baseHeaders;
}

export function withCors(env, response, request) {
	const headers = getCorsHeaders(env, request);
	if (Object.keys(headers).length === 0) return response;
	const newResponse = new Response(response.body, response);
	for (const [k, v] of Object.entries(headers)) newResponse.headers.set(k, v);
	return newResponse;
}

export function preflight(env, request) {
	return withCors(env, new Response(null, { status: 200 }), request);
}
