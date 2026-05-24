import { getConfig } from './config.js';
import { withCors } from './cors.js';

/**
 * Enhanced input sanitization with better security
 * @param {any} input - Input to sanitize
 * @param {Object} options - Sanitization options
 * @param {number} options.maxLength - Maximum allowed length (default: 2048)
 * @param {boolean} options.allowHtml - Whether to allow HTML characters (default: false)
 * @returns {any} Sanitized input
 */
export function sanitizeInput(input, { maxLength = 2048, allowHtml = false } = {}) {
	if (typeof input !== 'string') return input;
	
	let sanitized = input.trim();
	
	// Remove control characters and other dangerous characters
	sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
	
	// Remove potentially dangerous characters if HTML is not allowed
	if (!allowHtml) {
		sanitized = sanitized.replace(/[<>'"&]/g, '');
	}
	
	// Enforce length limit
	if (sanitized.length > maxLength) {
		sanitized = sanitized.substring(0, maxLength);
	}
	
	return sanitized;
}

/**
 * Create a JSON response with CORS headers
 * @param {Object} env - Cloudflare Worker environment
 * @param {any} data - Data to serialize as JSON
 * @param {Object} init - Response initialization options
 * @returns {Response} Response object with JSON content and CORS headers
 */
export function json(env, data, init = {}) {
	const response = new Response(JSON.stringify(data), {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
	});
	return withCors(env, response);
}

/**
 * Create a plain text response with CORS headers
 * @param {Object} env - Cloudflare Worker environment
 * @param {string} body - Response body text
 * @param {Object} init - Response initialization options
 * @returns {Response} Response object with text content and CORS headers
 */
export function text(env, body, init = {}) {
	const response = new Response(body, init);
	return withCors(env, response);
}

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - Promise to wrap
 * @param {Object} env - Cloudflare Worker environment (for config)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} timeoutMessage - Error message on timeout
 * @returns {Promise} Promise that rejects if timeout is exceeded
 */
export async function withTimeout(promise, env, timeoutMs, timeoutMessage = 'Operation timed out') {
	const { timeouts } = getConfig(env);
	const ms = timeoutMs ?? timeouts.default;
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
	]);
}

/**
 * Retry an operation with exponential backoff
 * @param {Function} operation - Async function to retry (receives attempt number)
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @returns {Promise} Result of the operation
 * @throws {Error} Last error if all retries fail
 */
export async function retryWithBackoff(operation, { maxRetries = 3, baseDelay = 1000 } = {}) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation(attempt);
		} catch (error) {
			if (attempt === maxRetries) throw error;
			const delay = baseDelay * Math.pow(2, attempt - 1);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
}

/**
 * Extract client IP address from request headers
 * @param {Request} request - Cloudflare Worker request
 * @returns {string} Client IP address or 'unknown'
 */
export function getClientIP(request) {
	const xff = request.headers.get('X-Forwarded-For');
	if (xff) return xff.split(',')[0].trim();
	return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * B1 (Sprint 2b): drop expired counters-table rows. The counters table
 * is no longer used for rate limiting (that moved to Cloudflare's native
 * Rate-Limit binding — see rateLimit.js), but it still backs the
 * per-shortcode password-session token store in routes/password.js. Each
 * verified password attempt writes a `pwd_session:<shortcode>:<token>`
 * row with an `expires_at` set 1 hour out; this sweep drops those after
 * they expire. The SQL is generic ("any row whose expires_at is past")
 * but in practice all such rows are password-session rows.
 *
 * Safe to run on every cron tick — the partial index on
 * `counters(expires_at) WHERE expires_at IS NOT NULL` keeps the scan
 * bounded to active sessions.
 */
export async function cleanupExpiredPasswordSessions(env) {
	const now = new Date().toISOString();
	const { dbRun } = await import('./db.js');
	await dbRun(env, `DELETE FROM counters WHERE expires_at IS NOT NULL AND expires_at < ?`, [now]);
}

/**
 * S2: hard-delete links whose `expires_at` timestamp is in the past.
 *
 * `expires_at` is `TEXT` (ISO 8601 datetime per schema.sql, e.g.
 * "2024-01-15T12:00:00.000Z"). Optional - links without a TTL store NULL
 * or empty string ('' is also tolerated because some legacy rows from
 * earlier admin UI versions wrote '' instead of leaving it NULL).
 *
 * Mirrors the existing `purgeOldAnalytics` policy: a hard DELETE rather
 * than soft-archive. The `links.archived` flag exists for user-initiated
 * archiving (UI: "Archive link"), which is semantically distinct from
 * "expired and should disappear". Archived links remain queryable; expired
 * ones are pruned to keep the table small.
 *
 * Idempotent and safe to run on every cron tick.
 */
export async function purgeExpiredLinks(env) {
	const now = new Date().toISOString();
	const { dbRun } = await import('./db.js');
	await dbRun(
		env,
		`DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at != '' AND expires_at < ?`,
		[now],
	);
}


