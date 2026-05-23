import { logger } from './logger.js';
import { handleRequest } from './routes.js';
import { withCors } from './cors.js';
import { json, cleanupExpiredCounters } from './utils.js';
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
	 * Cron handler. Wired in wrangler.jsonc via triggers.crons. H7+H18:
	 *   - Daily: purge analytics older than the retention window.
	 *   - Every run: clean up expired ephemeral counters.
	 */
	async scheduled(event, env, ctx) {
		const retentionDays = Number(env.ANALYTICS_RETENTION_DAYS || 365);
		const purge = purgeOldAnalytics(env, retentionDays).catch((err) =>
			logger.error('cron_purge_analytics_failed', { error: err?.message }),
		);
		const cleanup = cleanupExpiredCounters(env).catch((err) =>
			logger.error('cron_cleanup_counters_failed', { error: err?.message }),
		);
		ctx.waitUntil(Promise.all([purge, cleanup]));
	},
};


