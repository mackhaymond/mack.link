import { getConfig, getMockUser, isDevBypassEligible } from './config.js';
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

function isLocalHostHeader(request) {
	const host = (request.headers.get('Host') || '').toLowerCase();
	return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

/**
 * Resolve the user behind a request, or null if unauthenticated.
 *
 * Identity shape (preserved across the OAuth -> Access migration so
 * downstream callers like getOwnerId / routesLinks don't break):
 *   { login, email, name, id, avatar_url }
 *
 *  - `login` is derived from the email local-part (same as the GitHub
 *    `login` field for users whose GitHub username matches their primary
 *    email, which is the case for the single authorized user).
 *  - `id` is the Access subject claim (`sub`), prefixed-stable across
 *    Access sessions.
 */
export async function authenticateRequest(env, request) {
	if (isDevBypassEligible(env) && isLocalHostHeader(request)) {
		return getMockUser(env);
	}

	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token) return null;

	try {
		const payload = await verifyAccessJwt(token, env.TEAM_DOMAIN, env.POLICY_AUD);
		const email = String(payload.email || '');
		const login = email.includes('@') ? email.split('@')[0] : (payload.sub || 'unknown');
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
 * to short-circuit. Contract preserved verbatim from pre-Sprint-2a so
 * existing callsites in routerApi.js work unchanged:
 *
 *   const result = await requireAuth(env, request);
 *   if (result instanceof Response) return result;
 *   // ...use result as the user object...
 *
 * The AUTHORIZED_USER env var check is kept as belt-and-suspenders: Access
 * already restricts to allowed identities at the edge via its Allow policy,
 * but if Access were ever misconfigured (e.g. policy disabled while the
 * app stays Required) we still reject unknown logins here.
 */
export async function requireAuth(env, request) {
	const user = await authenticateRequest(env, request);
	if (!user) return withCors(env, new Response('Unauthorized', { status: 401 }), request);

	const { authorizedUser } = getConfig(env);
	const devBypass = isDevBypassEligible(env);
	if (!devBypass && authorizedUser && user.login !== authorizedUser) {
		return withCors(env, new Response('Forbidden: Access denied', { status: 403 }), request);
	}
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
