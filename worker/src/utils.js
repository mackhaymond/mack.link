import { getConfig } from './config.js';
import { dbAll } from './db.js';
import { withCors } from './cors.js';
import { logger } from './logger.js';

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

// Simple in-memory caches (edge-local) with size limits to prevent memory leaks
const MAX_CACHE_SIZE = 10000;

class BoundedMap extends Map {
	constructor(maxSize = MAX_CACHE_SIZE) {
		super();
		this.maxSize = maxSize;
	}
	
	set(key, value) {
		// Remove oldest entry if we're at capacity
		if (this.size >= this.maxSize) {
			const firstKey = this.keys().next().value;
			this.delete(firstKey);
		}
		return super.set(key, value);
	}
}

// Edge-local caches for token and rate limit data
export const tokenCache = new BoundedMap();
export const rateLimitCache = new BoundedMap();

/**
 * In-memory rate limiter fallback (used when D1 is unavailable)
 * @param {string} key - Rate limit key (usually IP address)
 * @param {Object} options - Rate limit options
 * @param {number} options.limit - Request limit (default: 100)
 * @param {number} options.windowMs - Time window in milliseconds (default: 1 hour)
 * @returns {boolean} True if rate limited
 */
export function isRateLimited(key, { limit = 100, windowMs = 3600000 } = {}) {
	const now = Date.now();
	const window = Math.floor(now / windowMs);
	const cacheKey = `${key}:${window}`;
	
	const current = rateLimitCache.get(cacheKey) || 0;
	rateLimitCache.set(cacheKey, current + 1);
	
	return current >= limit;
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
 * Persistent D1-based rate limiter.
 *
 * S2: prior versions opportunistically fired `cleanupExpiredCounters` from
 * the hot path on a 60s interval (`maybeScheduleCleanup`) so that the
 * counters table didn't accumulate stale rows between cron runs. That
 * approach added a `ctx.waitUntil` tax to every rate-limited endpoint call
 * and risked floating promises in non-runtime contexts (tests, scripts).
 *
 * Counter cleanup is now exclusively the cron handler's job (see
 * `scheduled` in src/index.js). Callers that still pass `ctx` in opts are
 * fine - it's ignored, since this function no longer needs it.
 */
export async function isRateLimitedPersistent(env, request, { key = 'default', limit = 100, windowMs = 3600000 } = {}) {
	try {
		const now = Date.now();
		const bucket = Math.floor(now / windowMs);
		const ip = getClientIP(request);
		const name = `rate:${key}:${windowMs}:${bucket}:${ip}`;
		const expiresAt = new Date(now + (windowMs * 2)).toISOString();
		const rows = await dbAll(env,
			`INSERT INTO counters (name, value, expires_at) VALUES (?, 1, ?)
			 ON CONFLICT(name) DO UPDATE SET 
			   value = counters.value + 1,
			   expires_at = excluded.expires_at
			 RETURNING value`,
			[name, expiresAt]
		);
		const value = (rows && rows[0] && (rows[0].value ?? rows[0].VALUE)) || 0;
		return Number(value) > Number(limit);
	} catch (e) {
		logger.warn('rate_limit_d1_fallback', { key, error: e?.message });
		const ip = getClientIP(request);
		return isRateLimited(ip, { limit, windowMs });
	}
}

/**
 * Clean expired entries from in-memory caches
 * Should be called periodically to prevent memory buildup
 */
export function cleanupCaches() {
	const now = Date.now();
	const oneHour = 3600000;
	
	// Clean up rate limit cache entries older than 2 windows
	for (const [key] of rateLimitCache.entries()) {
		const parts = key.split(':');
		const window = parseInt(parts[parts.length - 1]);
		const windowMs = parseInt(parts[parts.length - 3]) || oneHour;
		if (isNaN(window) || (now - window * windowMs) > (2 * windowMs)) {
			rateLimitCache.delete(key);
		}
	}
	
	// Token cache cleanup is handled by application logic
	// but we can clear very old entries (older than 24 hours)
	for (const [key, entry] of tokenCache.entries()) {
		if (entry && entry.timestamp && (now - entry.timestamp) > (24 * oneHour)) {
			tokenCache.delete(key);
		}
	}
}

export async function cleanupExpiredCounters(env) {
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


