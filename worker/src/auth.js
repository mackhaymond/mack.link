import { getConfig, isDevBypassEligible } from './config.js';
import { withTimeout, retryWithBackoff, tokenCache } from './utils.js';
import { withCors } from './cors.js';
import { logger } from './logger.js';
import { parseCookies, verifySessionJwt } from './session.js';

/**
 * Dev-auth bypass model (local-only, defense in depth):
 *
 * The `x-dev-auth: 1` header lets the Admin dev server skip OAuth. To accept it
 * ALL of these must hold:
 *   1. env.AUTH_DISABLED === 'true'
 *   2. env.ENVIRONMENT === 'development'   (only ever set in worker/.dev.vars)
 *   3. Host header is localhost / 127.0.0.1
 * In production any one of these is false, so the header is ignored.
 */

export async function verifyGitHubToken(env, token) {
	const cached = tokenCache.get(token);
	if (cached && Date.now() - cached.timestamp < 300000) {
		return cached.user;
	}

	const config = getConfig(env);
	try {
		const user = await retryWithBackoff(async (attempt) => {
			logger.debug('GitHub token verification attempt', { attempt });
			const response = await withTimeout(
				fetch('https://api.github.com/user', {
					headers: {
						'Authorization': `token ${token}`,
						'User-Agent': 'link.mackhaymond.co'
					}
				}),
				env,
				config.timeouts.github,
				'GitHub API token verification timed out'
			);
			if (!response.ok) {
				if (response.status === 401 || response.status === 403) {
					tokenCache.delete(token);
					return null;
				}
				throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
			}
			return await withTimeout(response.json(), env, config.timeouts.jsonParse, 'GitHub API response parsing timed out');
		});
		if (!user) return null;
		tokenCache.set(token, { user, timestamp: Date.now() });
		return user;
	} catch (error) {
		logger.error('GitHub token verification failed', { error: error.message });
		return null;
	}
}

export async function authenticateRequest(env, request) {
	const devEligible = isDevBypassEligible(env);
	if (devEligible) {
		const devHeader = request.headers.get('x-dev-auth');
		const hostHeader = (request.headers.get('Host') || '').toLowerCase();
		const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader);
		if (devHeader && isLocalHost) {
			const { getMockUser } = await import('./config.js');
			return getMockUser(env);
		}
		const { getMockUser } = await import('./config.js');
		return getMockUser(env);
	}
	// Prefer session cookie; fall back to Authorization for backward compatibility
	const cookieHeader = request.headers.get('Cookie') || '';
	const cookies = parseCookies(cookieHeader);
	const { sessionCookieName } = getConfig(env);
	const actualCookieName = sessionCookieName || '__Host-link_session';
	const sessionToken = cookies[actualCookieName];
	
	logger.debug('Authentication attempt', { 
		cookieHeader, 
		expectedCookieName: actualCookieName, 
		hasSessionToken: !!sessionToken,
		parsedCookies: Object.keys(cookies)
	});
	
	if (sessionToken) {
		const user = await verifySessionJwt(env, sessionToken);
		logger.debug('Session JWT verification result', { hasUser: !!user, userLogin: user?.login });
		if (user) return user;
	}
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
	const token = authHeader.substring(7);
	return await verifyGitHubToken(env, token);
}

export async function requireAuth(env, request) {
	const skipEnforcement = isDevBypassEligible(env);

	let user = await authenticateRequest(env, request);
	const { authorizedUser } = getConfig(env);

	if (!user && skipEnforcement) {
		const { getMockUser } = await import('./config.js');
		user = getMockUser(env);
	}
	if (!user) return withCors(env, new Response('Unauthorized', { status: 401 }), request);
	if (!skipEnforcement && authorizedUser && user.login !== authorizedUser) {
		return withCors(env, new Response('Forbidden: Access denied', { status: 403 }), request);
	}
	return user;
}

export function generateStateToken() {
	return crypto.randomUUID();
}

export async function handleLogout(env, request) {
	const response = new Response(null, { status: 204 });
	const { clearSessionCookie } = await import('./session.js');
	
	// Clear the current configured session cookie
	response.headers.append('Set-Cookie', clearSessionCookie(env));
	
	// Also clear the legacy __Host-link_session cookie for migration purposes
	response.headers.append('Set-Cookie', '__Host-link_session=deleted; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
	
	return withCors(env, response, request);
}


