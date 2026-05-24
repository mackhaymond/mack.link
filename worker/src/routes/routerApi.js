import { requireAuth, handleLogout } from '../auth.js';
import { withCors } from '../cors.js';
import { getAllLinks, createLink, updateLink, deleteLink, bulkDeleteLinks, getLink, bulkCreateLinks, listLinks } from './routesLinks.js';
import { handleGitHubAuth, handleGitHubCallback, handleDevAuthLogin } from './routesOAuth.js';
import { getTimeseries, getTimeseriesByLinks, getBreakdown, getOverview, exportAnalytics } from '../analytics.js';
import { handlePasswordVerification } from './password.js';
import { getReservedPathsList } from '../reservedPaths.js';
import { getOwnerId } from '../users.js';

export async function handleAPI(request, env, requestLogger) {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	// OAuth endpoints - no auth required
	if (path === '/api/auth/github') {
		return await handleGitHubAuth(request, env);
	}
	if (path === '/api/auth/callback') {
		return await handleGitHubCallback(request, env);
	}
	if (path === '/api/auth/logout' && method === 'POST') {
		return await handleLogout(env, request);
	}
	// Dev-only programmatic login endpoint
	if (path === '/api/auth/dev/login' && method === 'POST') {
		return await handleDevAuthLogin(request, env);
	}

	// Password verification endpoint (no auth required)
	if (path === '/api/password/verify' && method === 'POST') {
		return await handlePasswordVerification(request, env);
	}

	// Protected endpoints - auth required.
	// requireAuth() returns the resolved user (mock user in dev bypass, real user otherwise)
	// or a Response on failure. After authentication, ensure a users row exists and
	// derive the ownerId used for multi-tenant filtering (C6).
	let authResult = await requireAuth(env, request);
	if (authResult instanceof Response) return authResult;
	const ownerId = await getOwnerId(env, authResult);

	// Analytics endpoints (protected)
	if (path.startsWith('/api/analytics/')) {
		const urlObj = new URL(request.url);
		// shortcode is optional; if omitted, compute global analytics across all links
		const shortcode = urlObj.searchParams.get('shortcode');
		if (path === '/api/analytics/timeseries') {
			const from = urlObj.searchParams.get('from');
			const to = urlObj.searchParams.get('to');
			const data = await getTimeseries(env, shortcode, from, to);
			return withCors(env, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), request);
		}
		if (path === '/api/analytics/timeseries-links') {
			const from = urlObj.searchParams.get('from');
			const to = urlObj.searchParams.get('to');
			const limit = parseInt(urlObj.searchParams.get('limit') || '5', 10);
			const data = await getTimeseriesByLinks(env, from, to, limit);
			return withCors(env, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), request);
		}
		if (path === '/api/analytics/breakdown') {
			const dimension = urlObj.searchParams.get('dimension') || 'ref';
			const limit = parseInt(urlObj.searchParams.get('limit') || '10', 10);
			const from = urlObj.searchParams.get('from');
			const to = urlObj.searchParams.get('to');
			const data = await getBreakdown(env, shortcode, dimension, limit, from, to);
			return withCors(env, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), request);
		}
		if (path === '/api/analytics/overview') {
			const data = await getOverview(env, shortcode);
			return withCors(env, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), request);
		}
		if (path === '/api/analytics/export') {
			const from = urlObj.searchParams.get('from');
			const to = urlObj.searchParams.get('to');
			const format = urlObj.searchParams.get('format') || 'json';

			try {
				const data = await exportAnalytics(env, shortcode, from, to, format);
				const filename = `analytics-${shortcode || 'global'}-${from || 'all'}-${to || 'all'}.json`;

				return withCors(
					env,
					new Response(JSON.stringify(data, null, 2), {
						headers: {
							'Content-Type': 'application/json',
							'Content-Disposition': `attachment; filename="${filename}"`,
						},
					}),
					request,
				);
			} catch (error) {
				return withCors(
					env,
					new Response(JSON.stringify({ error: error.message }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}),
					request,
				);
			}
		}
	}

	if (path === '/api/links') {
		if (method === 'GET') {
			const u = new URL(request.url);
			if (u.searchParams.has('limit') || u.searchParams.has('cursor')) {
				return await listLinks(env, request, ownerId);
			}
			return await getAllLinks(env, request, ownerId);
		}
		if (method === 'POST') return await createLink(request, env, ownerId);
	}

	if (path === '/api/links/bulk') {
		if (method === 'DELETE') return await bulkDeleteLinks(request, env, ownerId);
		if (method === 'POST') return await bulkCreateLinks(request, env, ownerId);
	}

	if (path.startsWith('/api/links/')) {
		const shortcode = path.split('/')[3];
		if (method === 'PUT') return await updateLink(request, env, shortcode, ownerId);
		if (method === 'DELETE') return await deleteLink(env, shortcode, request, ownerId);
		if (method === 'GET') return await getLink(env, shortcode, request, ownerId);
	}

	if (path === '/api/user') {
		return withCors(env, new Response(JSON.stringify(authResult), { headers: { 'Content-Type': 'application/json' } }), request);
	}

	// Metadata endpoints (protected)
	if (path === '/api/meta/reserved-paths' && method === 'GET') {
		return await handleReservedPathsMetadata(env, request);
	}

	return withCors(env, new Response('API endpoint not found', { status: 404 }), request);
}

/**
 * Handle requests for reserved paths metadata.
 * Returns a list of reserved paths that cannot be used as shortcodes.
 */
async function handleReservedPathsMetadata(env, request) {
	try {
		const reservedPaths = getReservedPathsList();
		const response = {
			reserved: reservedPaths,
			count: reservedPaths.length,
			updatedAt: new Date().toISOString()
		};
		
		// Add cache headers to reduce API calls
		const headers = {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
			'ETag': `"${reservedPaths.length}-${reservedPaths[0] || 'empty'}"` // Simple ETag based on count and first item
		};
		
		return withCors(env, new Response(JSON.stringify(response), { headers }), request);
	} catch (error) {
		return withCors(
			env,
			new Response(JSON.stringify({ error: 'Failed to fetch reserved paths' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}),
			request
		);
	}
}
