// Centralized configuration access.

/**
 * Whether this Worker is allowed to run in dev-bypass mode.
 *
 * SECURITY: dev bypass (mock user, accepting the absence of a
 * Cf-Access-Jwt-Assertion header on localhost) requires BOTH:
 *   - AUTH_DISABLED=true
 *   - ENVIRONMENT=development
 * ENVIRONMENT is only ever set in worker/.dev.vars (never in
 * wrangler.jsonc vars / prod environment), so production cannot
 * accidentally enter dev mode even if AUTH_DISABLED leaks in.
 *
 * Sprint 2a (A2): the third defense-in-depth check (Host must be
 * localhost) is enforced in auth.js authenticateRequest, not here -
 * this helper just gates eligibility, not the actual bypass.
 */
export function isDevBypassEligible(env = {}) {
	const authDisabled = String(env.AUTH_DISABLED || '').toLowerCase() === 'true';
	const isDevEnv = String(env.ENVIRONMENT || '').toLowerCase() === 'development';
	return authDisabled && isDevEnv;
}

/**
 * Reads request-time config from env vars. Returns only fields still in
 * use after Sprint 2a (A2). Removed:
 *   - githubClientId / githubClientSecret (OAuth gone)
 *   - jwtSecret (no Worker-issued JWTs anymore)
 *   - sessionCookieName / sessionMaxAgeSeconds (no Worker session cookie)
 *   - allowedRedirectUris (no OAuth redirect_uri)
 *   - authDisabled (only the old routesOAuth.js read this; auth.js uses
 *     isDevBypassEligible(env) directly)
 *
 * `allowInsecureCookies` is preserved because routes/password.js still
 * sets a per-shortcode password-session cookie (that feature is
 * orthogonal to admin auth and not in scope for the Access migration).
 */
export function getConfig(env = {}) {
	const allowInsecureCookies = String(env.SESSION_ALLOW_INSECURE_COOKIES || '').toLowerCase() === 'true' || isDevBypassEligible(env);

	return {
		authorizedUser: env.AUTHORIZED_USER,
		allowInsecureCookies,
		authDisabledUserLogin: env.AUTH_DISABLED_USER_LOGIN,
		authDisabledUserName: env.AUTH_DISABLED_USER_NAME,
		authDisabledUserAvatarUrl: env.AUTH_DISABLED_USER_AVATAR_URL,
		allowedOrigins: parseList(env.ALLOWED_ORIGINS),
		timeouts: {
			default: 10000,
			jsonParse: 2000,
			github: 8000,
		},
		rateLimits: {
			createPerHour: 50,
			updatePerHour: 200,
			deletePerHour: 200,
			bulkCreatePerHour: 50,
			bulkDeletePerHour: 50,
			windowMs: 60 * 60 * 1000,
			// Password verify attempts per (shortcode + IP) per minute
			passwordVerifyPerMinute: 10,
		},
	};
}

function parseList(value) {
	if (!value || typeof value !== 'string') return [];
	return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// Mock user for dev-bypass mode. Identity shape matches what
// auth.js authenticateRequest returns from a real Access JWT, so
// downstream callers (getOwnerId, routesLinks) don't branch on dev vs prod.
export function getMockUser(env = {}) {
	const cfg = getConfig(env);
	const login = cfg.authDisabledUserLogin || 'ai-dev';
	return {
		login,
		email: `${login}@localhost`,
		id: `dev:${login}`,
		name: cfg.authDisabledUserName || 'AI Developer',
		avatar_url: cfg.authDisabledUserAvatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4',
	};
}
