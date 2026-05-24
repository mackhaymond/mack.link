/**
 * Structured logging system for Cloudflare Workers
 * Provides request-scoped logging with context and performance tracking
 */

class Logger {
	constructor() {
		this.requestId = null;
		this.context = {};
		this.startTime = null;
	}

	/**
	 * Set unique request ID for log correlation
	 * @param {string} id - Unique request identifier
	 * @returns {Logger} Logger instance for chaining
	 */
	setRequestId(id) {
		this.requestId = id;
		return this;
	}

	/**
	 * Add or update context data for all subsequent logs
	 * @param {Object} context - Context key-value pairs
	 * @returns {Logger} Logger instance for chaining
	 */
	setContext(context) {
		this.context = { ...this.context, ...context };
		return this;
	}

	/**
	 * Set request start time for duration tracking
	 * @param {number} timestamp - Start timestamp in milliseconds
	 * @returns {Logger} Logger instance for chaining
	 */
	setStartTime(timestamp) {
		this.startTime = timestamp;
		return this;
	}

	/**
	 * Internal log method that formats and outputs log entries
	 * @private
	 * @param {string} level - Log level
	 * @param {string} message - Log message
	 * @param {Object} data - Additional data to include
	 */
	_log(level, message, data = {}) {
		const logEntry = {
			timestamp: new Date().toISOString(),
			level: level.toUpperCase(),
			requestId: this.requestId,
			message,
			context: this.context,
			...data
		};
		
		if (this.startTime && !('duration' in data) && !('durationMs' in data)) {
			logEntry.durationMs = Date.now() - this.startTime;
		}
		
		console.log(JSON.stringify(logEntry, scrubSecrets));
	}

	/**
	 * Log debug message (development/troubleshooting)
	 * @param {string} message - Debug message
	 * @param {Object} data - Additional debug data
	 */
	debug(message, data) {
		this._log('debug', message, data);
	}

	/**
	 * Log info message (normal operations)
	 * @param {string} message - Info message
	 * @param {Object} data - Additional info data
	 */
	info(message, data) {
		this._log('info', message, data);
	}

	/**
	 * Log warning message (potential issues)
	 * @param {string} message - Warning message
	 * @param {Object} data - Additional warning data
	 */
	warn(message, data) {
		this._log('warn', message, data);
	}

	/**
	 * Log error message (failures)
	 * @param {string} message - Error message
	 * @param {Object} data - Additional error data
	 */
	error(message, data) {
		this._log('error', message, data);
	}

	/**
	 * Create a request-scoped logger with context
	 * @param {Request} request - Cloudflare Worker request
	 * @returns {Logger} New logger instance with request context
	 */
	forRequest(request) {
		const requestId = crypto.randomUUID();
		const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
		const userAgent = request.headers.get('User-Agent') || 'unknown';
		const country = request.cf?.country || 'unknown';
		
		return new Logger()
			.setRequestId(requestId)
			.setStartTime(Date.now())
			.setContext({
				method: request.method,
				url: request.url,
				clientIP,
				country,
				userAgent: userAgent.substring(0, 100)
			});
	}
}

/**
 * M14: JSON.stringify replacer that scrubs values likely to contain secrets.
 * Drops headers/keys that match known sensitive names, redacts query strings
 * for known credential params, and caps URL strings at 2KB.
 */
const SECRET_KEY_RE = /^(authorization|cookie|set-cookie|x-dev-auth|password|password_hash|jwt_secret|access_token|client_secret|api[_-]?key|session)$/i;
const URL_CRED_PARAMS = new Set(['session', 'password', 'token', 'code']);

function scrubSecrets(key, value) {
	if (typeof key === 'string' && SECRET_KEY_RE.test(key)) return '[REDACTED]';
	if (typeof value === 'string') {
		if (value.length > 2048) {
			value = value.slice(0, 2048) + `…(truncated ${value.length - 2048}B)`;
		}
		if (/^https?:\/\//i.test(value)) {
			try {
				const u = new URL(value);
				let mutated = false;
				for (const p of URL_CRED_PARAMS) {
					if (u.searchParams.has(p)) {
						u.searchParams.set(p, 'REDACTED');
						mutated = true;
					}
				}
				if (mutated) return u.toString();
			} catch {}
		}
	}
	return value;
}

export const logger = new Logger();
export { Logger, scrubSecrets };


