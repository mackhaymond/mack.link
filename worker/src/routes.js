import { withCors, preflight } from './cors.js';
import { handleRedirect } from './routes/redirect.js';
import { handleAPI } from './routes/routerApi.js';
import { handleAdmin } from './routes/admin.js';
import { authenticateRequest } from './auth.js';
import { logger } from './logger.js';

export async function handleRequest(request, env, requestLogger, ctx) {
	const url = new URL(request.url);

	if (request.method === 'OPTIONS') {
		return preflight(env, request);
	}

	if (url.pathname.startsWith('/api/')) {
		return await handleAPIWithSession(request, env, requestLogger);
	}

	// Handle admin panel routes
	if (url.pathname.startsWith('/admin')) {
		return await handleAdmin(request, env, requestLogger);
	}

	// Check if user is authenticated for root route
	if (url.pathname === '/' || url.pathname === '') {
		const cookieHeader = request.headers.get('Cookie') || '';
		requestLogger.info('Root route access attempt', { cookieHeader, pathname: url.pathname });
		
		const user = await authenticateRequest(env, request);
		if (user) {
			// User is authenticated, redirect to admin panel
			requestLogger.info('Redirecting authenticated user to admin panel', { user: user.login, cookieHeader });
			return withCors(env, new Response(null, { 
				status: 302, 
				headers: { 'Location': '/admin' } 
			}), request);
		} else {
			requestLogger.info('No authentication found, serving homepage', { cookieHeader });
		}
	}

	const redirectResponse = await handleRedirect(request, env, requestLogger, ctx);
	if (redirectResponse) return redirectResponse;
	return withCors(env, new Response(renderHomeHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }), request);
}

/**
 * B2 (Sprint 2b): wrap /api/* requests in a D1 Sessions API session so that
 * read replicas serve sequentially-consistent results. The contract:
 *
 *   1. Read the `x-d1-bookmark` request header (admin client passes the
 *      bookmark from its prior response, if any).
 *   2. Create a session via `env.DB.withSession(bookmark)`. The bookmark
 *      sentinel `'first-unconstrained'` lets the first read hit any
 *      replica — appropriate for first-load when no prior writes exist.
 *   3. Hand handlers an env whose `.DB` is the session, not the raw
 *      D1Database. This is API-compatible (`session.prepare/.batch/.first`
 *      match D1Database) so existing db.js helpers don't change.
 *   4. After the handler returns, attach `x-d1-bookmark` to the response
 *      so the client can pass it back next time and keep read-your-writes
 *      consistency across requests.
 *
 * Scope: API only. Hot-path (redirect.js, analytics writes) intentionally
 * stays on raw `env.DB` because those paths are already eventually
 * consistent by design and adding session bookkeeping would just add
 * pointless latency.
 *
 * Works fine even when read replication is OFF (the dashboard toggle
 * hasn't been flipped yet): `withSession` returns a session that always
 * targets the primary, and `getBookmark()` returns the primary's bookmark.
 * Code is identical either way — enabling replication is purely a runtime
 * dashboard switch.
 *
 * Failure modes:
 *   - If `env.DB` is missing (tests without DB binding), fall back to the
 *     raw env so handlers can still return their own errors.
 *   - If `getBookmark()` throws (no queries executed in the session),
 *     silently skip the response header.
 */
async function handleAPIWithSession(request, env, requestLogger) {
	if (!env?.DB || typeof env.DB.withSession !== 'function') {
		return await handleAPI(request, env, requestLogger);
	}
	const bookmark = request.headers.get('x-d1-bookmark') || 'first-unconstrained';
	const session = env.DB.withSession(bookmark);
	const sessionEnv = { ...env, DB: session };
	const response = await handleAPI(request, sessionEnv, requestLogger);
	try {
		const bm = session.getBookmark();
		if (bm) {
			const cloned = new Response(response.body, response);
			cloned.headers.set('x-d1-bookmark', bm);
			return cloned;
		}
	} catch (err) {
		logger.warn('d1_session_bookmark_failed', { error: err?.message });
	}
	return response;
}

function renderHomeHtml() {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>link.mackhaymond.co • Fast personal short links</title>
  <style>
    :root{--bg:#0b1220;--muted:#9aa4b2;--text:#eef2f7;--ring:rgba(96,165,250,.25)}
    *{box-sizing:border-box}
    body{margin:0;background:
      radial-gradient(1400px 900px at 70% -10%, rgba(32,99,235,.18), transparent 60%),
      radial-gradient(900px 600px at 0% 110%, rgba(96,165,250,.14), transparent 60%),
      conic-gradient(from 180deg at 50% 30%, rgba(96,165,250,.05), transparent 40%),
      var(--bg);
      color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
    .wrap{min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
    .hero{width:100%;max-width:880px;text-align:center}
    .logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#60a5fa,#2563eb);display:inline-block;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);vertical-align:middle}
    h1{font-size:32px;margin:14px 0 8px}
    p.sub{margin:0;color:var(--muted)}
    a.btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:var(--text);padding:12px 16px;border-radius:12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:.2s ease}
    a.btn:hover{border-color:rgba(96,165,250,.7);box-shadow:0 0 0 4px var(--ring)}
    a.btn.small{height:40px;padding:0 14px;font-size:14px}
    .icon-btn{width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:12px;color:var(--text);transition:.2s ease;text-decoration:none}
    .icon-btn:hover{border-color:rgba(96,165,250,.7);box-shadow:0 0 0 4px var(--ring)}
    .icon{width:20px;height:20px;display:block;fill:currentColor}
    .topbar{position:fixed;top:16px;right:16px;display:flex;gap:10px;align-items:center;z-index:10}
    .kbd{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);padding:2px 6px;border-radius:6px}
    .foot{margin-top:20px;color:#9aa4b2;font-size:12px}
    code{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <div class="topbar">
    <a class="icon-btn" href="https://github.com/mackhaymond/mack.link" target="_blank" rel="noopener noreferrer" aria-label="View source on GitHub">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.8-.25.8-.57v-2.1c-3.26.71-3.95-1.57-3.95-1.57-.53-1.35-1.3-1.71-1.3-1.71-1.06-.73.08-.72.08-.72 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.39.97.11-.77.41-1.27.74-1.56-2.6-.3-5.35-1.3-5.35-5.78 0-1.28.46-2.33 1.2-3.16-.12-.3-.52-1.52.11-3.17 0 0 .98-.31 3.2 1.2a11.1 11.1 0 0 1 5.82 0c2.22-1.51 3.2-1.2 3.2-1.2.63 1.65.23 2.87.11 3.17.75.83 1.2 1.88 1.2 3.16 0 4.49-2.75 5.47-5.37 5.76.42.37.8 1.1.8 2.22v3.29c0 .32.2.69.8.57A11.5 11.5 0 0 0 12 .5Z"/>
      </svg>
    </a>
    <a class="btn small" href="/admin">Sign in to Admin</a>
  </div>
  <div class="wrap">
    <main class="hero">
      <div class="logo"></div>
      <h1>link.mackhaymond.co</h1>
      <p class="sub">Fast personal URL shortener on Cloudflare Workers. Secure. Simple. Beautiful.</p>
      <div class="foot">Tip: paste a shortcode after the domain to jump to a destination, e.g. <code>/github</code></div>
    </main>
  </div>
</body>
</html>`;
}
