import { getConfig, getMockUser, isDevBypassEligible } from '../config.js';
import { withCors, isRedirectUriAllowed } from '../cors.js';
import { generateStateToken } from '../auth.js';
import { withTimeout, retryWithBackoff } from '../utils.js';
import { logger } from '../logger.js';

function jsonError(env, request, status, error, description) {
	return withCors(
		env,
		new Response(JSON.stringify({ error, error_description: description }), {
			status,
			headers: { 'Content-Type': 'application/json' },
		}),
		request,
	);
}

// Dev-only: programmatic login endpoint for Playwright/AI when AUTH_DISABLED=true.
// Only enabled when isDevBypassEligible() is true (AUTH_DISABLED=true AND ENVIRONMENT=development).
export async function handleDevAuthLogin(request, env) {
	if (!isDevBypassEligible(env)) {
		return jsonError(env, request, 403, 'forbidden', 'Dev auth not enabled');
	}
	try {
		// Optional overrides via body { login, name, avatar_url }
		let overrides = {};
		if ((request.method || 'GET').toUpperCase() === 'POST') {
			try {
				const text = await request.text();
				if (text) {
					const parsed = JSON.parse(text);
					overrides = {
						login: typeof parsed.login === 'string' && parsed.login.trim().length > 0 ? parsed.login.trim() : undefined,
						name: typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name.trim() : undefined,
						avatar_url: typeof parsed.avatar_url === 'string' && /^https?:\/\//.test(parsed.avatar_url) ? parsed.avatar_url : undefined,
					};
				}
			} catch {}
		}
		const baseUser = getMockUser(env);
		const user = {
			...baseUser,
			...(overrides.login ? { login: overrides.login } : {}),
			...(overrides.name ? { name: overrides.name } : {}),
			...(overrides.avatar_url ? { avatar_url: overrides.avatar_url } : {}),
		};
		const { createSessionJwt, buildSessionCookie } = await import('../session.js');
		const sessionJwt = await createSessionJwt(env, user);
		const sessionCookie = buildSessionCookie(sessionJwt, env);
		const response = new Response(JSON.stringify({ user }), { headers: { 'Content-Type': 'application/json' } });
		response.headers.append('Set-Cookie', sessionCookie);
		return withCors(env, response, request);
	} catch (error) {
		logger.error('Dev auth login failed', { error: error.message });
		return withCors(env, new Response(JSON.stringify({ error: 'dev_auth_failed', error_description: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }), request);
	}
}

export async function handleGitHubAuth(request, env) {
	const url = new URL(request.url);
	const redirectUri = url.searchParams.get('redirect_uri') || 'http://localhost:5173/auth/callback';
	if (!isRedirectUriAllowed(env, redirectUri)) {
		logger.warn('OAuth start: rejecting redirect_uri not on allow-list', { redirectUri });
		return jsonError(env, request, 400, 'invalid_redirect_uri', 'redirect_uri is not on the allow-list');
	}
	const state = generateStateToken();
	const config = getConfig(env);

	// Short-circuit for auth-disabled dev mode: set a session for a mock user and bounce to callback
	if (config.authDisabled) {
		try {
			const { createSessionJwt, buildSessionCookie } = await import('../session.js');
			const user = getMockUser(env);
			logger.info('Auth-disabled mode: issuing mock session and redirecting to callback', { redirectUri, login: user.login });
			const sessionJwt = await createSessionJwt(env, user);
			const sessionCookie = buildSessionCookie(sessionJwt, env);
			const secure = config.allowInsecureCookies ? '' : ' Secure;';
			const sameSite = config.allowInsecureCookies ? 'Lax' : 'None';
			const oauthStateCookie = `oauth_state=${state}; Max-Age=600; Path=/; HttpOnly;${secure} SameSite=${sameSite}`;
			const callbackUrl = new URL(redirectUri);
			callbackUrl.searchParams.set('code', 'disabled');
			callbackUrl.searchParams.set('state', state);
			const resp = new Response(null, { status: 302, headers: { 'Location': callbackUrl.toString() } });
			resp.headers.append('Set-Cookie', sessionCookie);
			resp.headers.append('Set-Cookie', oauthStateCookie);
			return withCors(env, resp, request);
		} catch (error) {
			logger.error('Auth-disabled mode: failed to issue session', { error: error.message });
			return withCors(env, new Response(JSON.stringify({ error: 'dev_oauth_disabled_failed', error_description: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }), request);
		}
	}

	const authUrl = new URL('https://github.com/login/oauth/authorize');
	authUrl.searchParams.set('client_id', config.githubClientId);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('scope', 'user:email');
	authUrl.searchParams.set('state', state);
	logger.info('OAuth flow initiated', { state, redirectUri });
	// Build redirect response manually to allow setting Set-Cookie
	const secure = config.allowInsecureCookies ? '' : ' Secure;';
	const sameSite = config.allowInsecureCookies ? 'Lax' : 'None';
	const cookie = `oauth_state=${state}; Max-Age=600; Path=/; HttpOnly;${secure} SameSite=${sameSite}`;
	const redirectResponse = new Response(null, { status: 302, headers: { 'Location': authUrl.toString(), 'Set-Cookie': cookie } });
	return withCors(env, redirectResponse, request);
}

export async function handleGitHubCallback(request, env) {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code) return withCors(env, new Response('No code provided', { status: 400 }));
	logger.info('OAuth callback processing', { state });
	const config = getConfig(env);
	// Verify OAuth state from cookie
	const cookieHeader = request.headers.get('Cookie') || '';
	const cookies = Object.fromEntries(cookieHeader.split(/;\s*/).filter(Boolean).map(kv => {
		const idx = kv.indexOf('=');
		if (idx === -1) return [kv, ''];
		return [kv.slice(0, idx), kv.slice(idx + 1)];
	}));
	const cookieState = cookies['oauth_state'];
	// H3: state must always validate. The dev-login flow has its own endpoint
	// (/api/auth/dev/login) so the real OAuth flow must not relax CSRF checks.
	if (!cookieState || !state || cookieState !== state) {
		return jsonError(env, request, 400, 'invalid_state', 'OAuth state mismatch');
	}

	// Short-circuit for auth-disabled dev mode: return mock user and set/refresh session
	if (config.authDisabled) {
		const { createSessionJwt, buildSessionCookie, clearOauthStateCookie } = await import('../session.js');
		const user = getMockUser(env);
		logger.info('Auth-disabled mode: returning mock user from callback', { login: user.login });
		const sessionJwt = await createSessionJwt(env, user);
		const sessionCookie = buildSessionCookie(sessionJwt, env);
		const response = new Response(JSON.stringify({ user }), { headers: { 'Content-Type': 'application/json' } });
		response.headers.append('Set-Cookie', sessionCookie);
		response.headers.append('Set-Cookie', clearOauthStateCookie(env));
		return withCors(env, response, request);
	}

	try {
		const tokenData = await retryWithBackoff(async (attempt) => {
			const tokenResponse = await withTimeout(
				fetch('https://github.com/login/oauth/access_token', {
					method: 'POST',
					headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ client_id: config.githubClientId, client_secret: config.githubClientSecret, code })
				}),
				env,
				config.timeouts.github,
				'GitHub OAuth token exchange timed out'
			);
			if (!tokenResponse.ok) throw new Error(`GitHub OAuth token exchange failed: ${tokenResponse.status}`);
			const data = await withTimeout(tokenResponse.json(), env, config.timeouts.jsonParse, 'GitHub OAuth token response parsing timed out');
			if (data.error) throw new Error(`OAuth error: ${data.error_description || data.error}`);
			return data;
		});
		const user = await retryWithBackoff(async (attempt) => {
			const userResponse = await withTimeout(
				fetch('https://api.github.com/user', { headers: { 'Authorization': `token ${tokenData.access_token}`, 'User-Agent': 'link.mackhaymond.co' } }),
				env,
				config.timeouts.github,
				'GitHub user info fetch timed out'
			);
			if (!userResponse.ok) throw new Error(`GitHub user fetch failed: ${userResponse.status}`);
			return await withTimeout(userResponse.json(), env, config.timeouts.jsonParse, 'GitHub user info response parsing timed out');
		});
		if (config.authorizedUser && user.login !== config.authorizedUser) {
			return withCors(env, new Response(JSON.stringify({ error: 'access_denied', error_description: `Access denied. Only ${config.authorizedUser} is authorized to use this service.` }), { status: 403, headers: { 'Content-Type': 'application/json' } }), request);
		}
		// Create session JWT and set in HttpOnly cookie. Do not expose GitHub token to the client.
		const { createSessionJwt, buildSessionCookie, clearOauthStateCookie } = await import('../session.js');
		logger.info('Creating session for user', { login: user.login, id: user.id });
		const sessionJwt = await createSessionJwt(env, { login: user.login, id: user.id, avatar_url: user.avatar_url, name: user.name });
		logger.info('Session JWT created', { jwtLength: sessionJwt?.length });
		const sessionCookie = buildSessionCookie(sessionJwt, env);
		logger.info('Session cookie built', { cookiePreview: sessionCookie.substring(0, 50) + '...' });
		const responseBody = { user };
		const response = new Response(JSON.stringify(responseBody), { headers: { 'Content-Type': 'application/json' } });
		response.headers.append('Set-Cookie', sessionCookie);
		// Clear oauth_state cookie after successful exchange
		response.headers.append('Set-Cookie', clearOauthStateCookie(env));
		logger.info('OAuth callback complete', { userId: user.login, cookiesSet: 2 });
		return withCors(env, response, request);
	} catch (error) {
		logger.error('OAuth callback error', { error: error.message });
		return withCors(env, new Response(JSON.stringify({ error: 'oauth_callback_failed', error_description: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }), request);
	}
}
