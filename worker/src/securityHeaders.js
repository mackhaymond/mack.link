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
 * CSP for HTML responses. Allows 'unsafe-inline' for script + style because
 * the password-prompt template inlines both. A future refactor could move
 * those to hashed/served assets and tighten script-src to 'self' + nonce.
 */
const CSP_HTML =
	"default-src 'self'; " +
	"img-src 'self' data: https:; " +
	"style-src 'self' 'unsafe-inline'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'";

/**
 * Wrap a Response with standard security headers.
 * For HTML responses (admin SPA, password prompt, redirect error pages) it
 * also adds Content-Security-Policy. Idempotent - re-applying is harmless.
 */
export function withSecurityHeaders(env, request, response) {
	const url = new URL(request.url);
	const isLocalHost = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
	const headers = commonHeaders(isLocalHost);

	const contentType = response.headers.get('Content-Type') || '';
	if (contentType.includes('text/html')) {
		headers['Content-Security-Policy'] = CSP_HTML;
	}

	const merged = new Response(response.body, response);
	for (const [k, v] of Object.entries(headers)) merged.headers.set(k, v);
	return merged;
}

export { CSP_HTML };
