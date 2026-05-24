/**
 * Common security headers applied to every response.
 * HSTS is only added in production (skipped on localhost) to avoid pinning
 * dev browsers to HTTPS for localhost.
 */
function commonHeaders(isLocalHost) {
	const h = {
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Permissions-Policy': 'interest-cohort=()',
	};
	if (!isLocalHost) {
		h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
	}
	return h;
}

/**
 * Default CSP for HTML responses we don't own (admin SPA served via
 * Cloudflare Static Assets). Keeps 'unsafe-inline' for script + style
 * because the Vite-built admin bundle inlines a small bootstrap and we
 * can't reach into the SPA build to inject per-request nonces.
 */
const CSP_HTML_DEFAULT =
	"default-src 'self'; " +
	"img-src 'self' data: https:; " +
	"style-src 'self' 'unsafe-inline'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'";

/**
 * B3 (Sprint 2b): Generate a per-request CSP nonce. 128 bits of entropy
 * from `crypto.randomUUID()` with hyphens stripped — sufficient for
 * "unguessable by network attacker within the request lifetime" per the
 * CSP3 nonce requirements.
 */
export function generateCspNonce() {
	return crypto.randomUUID().replace(/-/g, '');
}

/**
 * B3 (Sprint 2b): CSP for HTML responses where the Worker rendered the
 * markup itself (password prompt, redirect error pages, marketing
 * homepage). Drops `'unsafe-inline'` from style-src and script-src in
 * favor of an explicit nonce on each inline `<style>` / `<script>` tag.
 * Browsers will refuse to execute/apply any inline content WITHOUT a
 * matching nonce, closing one XSS surface.
 *
 * The Worker generates a fresh nonce per request and threads it into
 * the render function AND this header builder. The two values MUST
 * match — that's what makes the nonce protection meaningful.
 */
export function htmlCspWithNonce(nonce) {
	return (
		"default-src 'self'; " +
		"img-src 'self' data: https:; " +
		`style-src 'self' 'nonce-${nonce}'; ` +
		`script-src 'self' 'nonce-${nonce}'; ` +
		"connect-src 'self'; " +
		"frame-ancestors 'none'; " +
		"base-uri 'self'; " +
		"form-action 'self'"
	);
}

/**
 * Wrap a Response with standard security headers. For HTML responses
 * (admin SPA, password prompt, redirect error pages) it also adds a
 * default Content-Security-Policy IF the response doesn't already have
 * one set.
 *
 * B3 (Sprint 2b): the "doesn't already have one" condition lets
 * Worker-rendered HTML routes (password prompt, redirect errors,
 * homepage) opt into a tightened nonce-based CSP by setting their own
 * Content-Security-Policy header on the response. This function then
 * leaves that custom CSP untouched and only adds the common headers
 * (HSTS, nosniff, X-Frame-Options, etc.). Idempotent.
 */
export function withSecurityHeaders(env, request, response) {
	const url = new URL(request.url);
	const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
	const headers = commonHeaders(isLocalHost);

	const contentType = response.headers.get('Content-Type') || '';
	if (contentType.includes('text/html') && !response.headers.get('Content-Security-Policy')) {
		headers['Content-Security-Policy'] = CSP_HTML_DEFAULT;
	}

	const merged = new Response(response.body, response);
	for (const [k, v] of Object.entries(headers)) merged.headers.set(k, v);
	return merged;
}

export { CSP_HTML_DEFAULT };
