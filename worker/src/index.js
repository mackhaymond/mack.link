import { logger } from './logger.js';
import { handleRequest } from './routes.js';
import { withCors } from './cors.js';
import { json, cleanupExpiredCounters, purgeExpiredLinks } from './utils.js';
import { withSecurityHeaders } from './securityHeaders.js';
import { purgeOldAnalytics } from './analytics.js';

/**
 * Categorize errors for appropriate HTTP response and logging
 * @param {Error} error - Error object to categorize
 * @returns {{status: number, message: string, category: string}} Error response details
 */
function categorizeError(error) {
	const msg = error.message?.toLowerCase() || '';
	
	// Rate limiting errors
	if (msg.includes('rate limit') || msg.includes('too many requests')) {
		return { status: 429, message: 'Too Many Requests', category: 'rate_limit' };
	}
	
	// Database errors
	if (msg.includes('database') || msg.includes('d1') || msg.includes('sqlite')) {
		return { status: 503, message: 'Service Temporarily Unavailable', category: 'database' };
	}
	
	// Validation errors
	if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required')) {
		return { status: 400, message: 'Bad Request', category: 'validation' };
	}
	
	// Authentication errors
	if (msg.includes('unauthorized') || msg.includes('auth') || msg.includes('forbidden')) {
		return { status: 401, message: 'Unauthorized', category: 'auth' };
	}
	
	// Not found errors
	if (msg.includes('not found') || msg.includes('missing')) {
		return { status: 404, message: 'Not Found', category: 'not_found' };
	}
	
	// Timeout errors
	if (msg.includes('timeout') || msg.includes('timed out')) {
		return { status: 504, message: 'Gateway Timeout', category: 'timeout' };
	}
	
	// Default to internal server error
	return { status: 500, message: 'Internal Server Error', category: 'internal' };
}

export default {
	async fetch(request, env, ctx) {
		const requestLogger = logger.forRequest(request);
		const startTime = Date.now();
		try {
			requestLogger.info('Request started');
			const response = await handleRequest(request, env, requestLogger, ctx);
			const duration = Date.now() - startTime;
			requestLogger.info('Request completed', { statusCode: response.status, duration: `${duration}ms` });
			return withSecurityHeaders(env, request, response);
		} catch (error) {
			const duration = Date.now() - startTime;
			const errorInfo = categorizeError(error);
			
			requestLogger.error('Request failed', { 
				error: error.message, 
				stack: error.stack?.substring(0, 500), // Limit stack trace length
				duration: `${duration}ms`,
				category: errorInfo.category,
				statusCode: errorInfo.status
			});
			
			const url = new URL(request.url);
			let errorResponse;
			if (url.pathname.startsWith('/api/')) {
				errorResponse = json(env, {
					error: errorInfo.message,
					category: errorInfo.category,
					timestamp: new Date().toISOString()
				}, { status: errorInfo.status });
			} else {
				errorResponse = withCors(env, new Response(errorInfo.message, { status: errorInfo.status }));
			}
			return withSecurityHeaders(env, request, errorResponse);
		}
	},

	/**
	 * Cron handler. Wired in wrangler.jsonc via triggers.crons (daily at
	 * 03:00 UTC). All cleanup runs are consolidated here:
	 *   - H18 purgeOldAnalytics: drop analytics_day/_agg rows older than
	 *     ANALYTICS_RETENTION_DAYS (default 365).
	 *   - H7  cleanupExpiredCounters: drop counters rows whose `expires_at`
	 *     is in the past (rate-limit buckets, password sessions, etc.).
	 *     S2 removed the opportunistic 60s-gated hot-path call - this cron
	 *     run is now the sole owner of counter cleanup.
	 *   - S2  purgeExpiredLinks: hard-delete links whose `expires_at` is
	 *     past, mirroring the analytics policy (vs. the user-driven
	 *     `archived` flag, which is preserved).
	 *
	 * All three are wrapped in `.catch` to log + swallow per-task failures
	 * so one broken task doesn't poison the others. The `ctx.waitUntil`
	 * keeps the runtime alive until all settle.
	 */
	async scheduled(event, env, ctx) {
		const retentionDays = Number(env.ANALYTICS_RETENTION_DAYS || 365);
		const purgeAnalytics = purgeOldAnalytics(env, retentionDays).catch((err) =>
			logger.error('cron_purge_analytics_failed', { error: err?.message }),
		);
		const cleanupCounters = cleanupExpiredCounters(env).catch((err) =>
			logger.error('cron_cleanup_counters_failed', { error: err?.message }),
		);
		const purgeLinks = purgeExpiredLinks(env).catch((err) =>
			logger.error('cron_purge_expired_links_failed', { error: err?.message }),
		);
		ctx.waitUntil(Promise.all([purgeAnalytics, cleanupCounters, purgeLinks]));
	},
};


