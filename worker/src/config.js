// Centralized configuration access

/**
 * Whether this Worker is allowed to run in dev-bypass mode.
 *
 * SECURITY: dev bypass (mock user, JWT_SECRET fallback, accepting `x-dev-auth`
 * header) requires BOTH:
 *   - AUTH_DISABLED=true
 *   - ENVIRONMENT=development
 * ENVIRONMENT is only ever set in worker/.dev.vars (never in wrangler.jsonc
 * vars / prod environment), so production cannot accidentally enter dev mode
 * even if AUTH_DISABLED is set.
 */
export function isDevBypassEligible(env = {}) {
	const authDisabled = String(env.AUTH_DISABLED || '').toLowerCase() === 'true';
	const isDevEnv = String(env.ENVIRONMENT || '').toLowerCase() === 'development';
	return authDisabled && isDevEnv;
}

export function getConfig(env = {}) {
	const authDisabled = isDevBypassEligible(env);
	const allowInsecureCookies = String(env.SESSION_ALLOW_INSECURE_COOKIES || '').toLowerCase() === 'true' || authDisabled;
	const defaultCookieName = env.SESSION_COOKIE_NAME || '__Host-link_session';
	// Keep __Host- prefix; it works over http://localhost as long as Domain attr is omitted.
	const sessionCookieName = defaultCookieName;

	// JWT_SECRET handling:
	//  - In production (no dev bypass): missing JWT_SECRET is a hard failure.
	//    We defer the throw to the first session create/verify call so module
	//    import (and Cloudflare warmup) never crashes.
	//  - In dev bypass mode: allow a deterministic local-only fallback.
	let jwtSecret = env.JWT_SECRET;
	if (!jwtSecret && authDisabled) {
		jwtSecret = 'dev-local-only-NEVER-use-in-prod';
	}

	return {
		githubClientId: env.GITHUB_CLIENT_ID,
		githubClientSecret: env.GITHUB_CLIENT_SECRET,
		authorizedUser: env.AUTHORIZED_USER,
		jwtSecret,
		sessionCookieName,
		sessionMaxAgeSeconds: env.SESSION_MAX_AGE || 60 * 60 * 8,
		// Development-only override to disable OAuth and simulate a logged-in user.
		// Always false in production (gated by isDevBypassEligible).
		authDisabled,
		// Allow insecure cookies (no Secure flag) in local dev; auto-enabled when in dev bypass
		allowInsecureCookies,
		// Optional mock user overrides for disabled auth mode
		authDisabledUserLogin: env.AUTH_DISABLED_USER_LOGIN,
		authDisabledUserName: env.AUTH_DISABLED_USER_NAME,
		authDisabledUserAvatarUrl: env.AUTH_DISABLED_USER_AVATAR_URL,
		// Origins allowed for CORS + OAuth redirects. Comma-separated env var.
		// Localhost origins are always allowed in dev bypass mode (handled in cors.js).
		allowedOrigins: parseList(env.ALLOWED_ORIGINS),
		allowedRedirectUris: parseList(env.ALLOWED_REDIRECT_URIS),
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

/**
 * Resolve the JWT secret for production use, throwing if missing.
 * Called from session.js (createSessionJwt / verifySessionJwt).
 */
export function requireJwtSecret(env = {}) {
	const cfg = getConfig(env);
	if (!cfg.jwtSecret) {
		throw new Error('JWT_SECRET is required in production. Set it via `wrangler secret put JWT_SECRET`.');
	}
	return cfg.jwtSecret;
}

// Helper to produce a mock user for auth-disabled mode
export function getMockUser(env = {}) {
	const cfg = getConfig(env);
	return {
		login: cfg.authDisabledUserLogin || 'ai-dev',
		id: 0,
		name: cfg.authDisabledUserName || 'AI Developer',
		avatar_url: cfg.authDisabledUserAvatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4',
	};
}
