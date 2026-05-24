import { getMockUser, isDevBypassEligible } from './config.js';
import { verifyAccessJwt } from './access.js';
import { withCors } from './cors.js';
import { logger } from './logger.js';

// Sprint 2a (A1): All admin/API auth is now done by Cloudflare Access in
// front of the Worker. The Worker only verifies the `Cf-Access-Jwt-Assertion`
// header that Access injects on every proxied request - this proves the
// request really came through Access (and not via someone hitting the
// *.workers.dev backend URL directly).
//
// Dev bypass (local-only, defense in depth):
//   `npm run dev:ai` mode where Access doesn't intercept localhost. The
//   bypass returns a mock user iff ALL of these hold:
//     1. env.AUTH_DISABLED === 'true'      (must be explicitly enabled)
//     2. env.ENVIRONMENT === 'development' (only ever set in worker/.dev.vars)
//     3. Host header is localhost / 127.0.0.1
//   Production env never has #2, so the bypass cannot trigger even if #1
//   leaked into prod by accident.

// Pull the request host from request.url rather than the Host header.
// In the Fetch API runtime (Workers, miniflare, vitest-pool-workers) the
// Host header is one of the forbidden headers that `Headers.get('Host')`
// returns null for - we'd silently fail-open if we relied on it. The
// URL is what the runtime actually saw and is harder to spoof: the
// edge sets the URL before our handler runs.
function isLocalHostRequest(request) {
	try {
		const host = new URL(request.url).host.toLowerCase();
		return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
	} catch {
		return false;
	}
}

/**
 * Resolve the user behind a request, or null if unauthenticated.
 *
 * Identity shape:
 *   { login, email, name, id, avatar_url }
 *
 * B4b (Sprint 2b): `login` is now the FULL email (e.g.
 * "mack.haymond@icloud.com"), not the local-part. Reasons:
 *   - The previous local-part-only derivation collided across domains
 *     ("mack@a.com" and "mack@b.com" both yielded login="mack")
 *   - It made plus-addressing ugly ("mack+test@icloud.com" → login="mack+test")
 *   - downstream owner_id derivation in users.js becomes simpler (the
 *     gh:* prefix is gone; owner_id IS the email)
 *
 * `id` is the Access subject claim (`sub`), prefixed-stable across
 * Access sessions.
 */
export async function authenticateRequest(env, request) {
	if (isDevBypassEligible(env) && isLocalHostRequest(request)) {
		return getMockUser(env);
	}

	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token) return null;

	try {
		const payload = await verifyAccessJwt(token, env.TEAM_DOMAIN, env.POLICY_AUD);
		const email = String(payload.email || '');
		const login = email || payload.sub || 'unknown';
		return {
			login,
			email,
			name: payload.name || email || login,
			id: payload.sub,
			avatar_url: payload.avatar_url || '',
		};
	} catch (e) {
		logger.warn('access_jwt_verify_failed', { error: e.message });
		return null;
	}
}

/**
 * Auth-gate a request and return the resolved user, or return a Response
 * to short-circuit. Contract preserved verbatim:
 *
 *   const result = await requireAuth(env, request);
 *   if (result instanceof Response) return result;
 *   // ...use result as the user object...
 *
 * B4a (Sprint 2b): the prior AUTHORIZED_USER belt-and-suspenders check
 * is GONE. Authorization is enforced upstream by Cloudflare Access's
 * Allow policy at the edge — that's the source of truth for "who can
 * access this app". The duplicated Worker-side check already bit us
 * once (Sprint 2a postmortem: the Worker compared 'mack.haymond' to
 * 'mackhaymond' and 403'd production for an hour). Don't reintroduce
 * the double-source-of-truth pattern; trust the edge policy.
 *
 * If Access is ever misconfigured (Allow policy disabled while app
 * stays Required), the failure mode is "anyone in the org reaches
 * the worker", not "no one can". Detect via SECURITY.md path-coverage
 * audits, not in-band Worker logic.
 */
export async function requireAuth(env, request) {
	const user = await authenticateRequest(env, request);
	if (!user) return withCors(env, new Response('Unauthorized', { status: 401 }), request);
	return user;
}

/**
 * Logout. With Cloudflare Access, the actual session lives at the Access
 * layer, not in a Worker-issued cookie. We redirect to Cloudflare's logout
 * endpoint, which clears the CF_Authorization cookie and bounces the user
 * back to the team login page.
 *
 * Returns 204 + a JSON body to preserve the prior endpoint shape - the
 * admin frontend's logout call is fire-and-forget, but legacy clients
 * that did `await fetch(...).then(r => r.json())` won't crash.
 */
export async function handleLogout(env, request) {
	const team = (env.TEAM_DOMAIN || '').replace(/\/+$/, '');
	const logoutUrl = team ? `${team}/cdn-cgi/access/logout` : '/cdn-cgi/access/logout';
	return withCors(
		env,
		new Response(JSON.stringify({ logout: logoutUrl }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
		request,
	);
}
