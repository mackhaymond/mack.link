// B1: Wrapper around Cloudflare's native Rate-Limit binding.
//
// The binding (configured in wrangler.jsonc under `ratelimits`) exposes a
// `.limit({ key })` method that returns `{ success: boolean }` synchronously
// against a per-Cloudflare-location counter. Limits are sub-millisecond and
// free; see SECURITY.md for the per-PoP / eventually-consistent caveat.
//
// Two design goals for this wrapper:
//   1. Fail-OPEN if the binding is missing or throws. Rate limiting is a
//      defense-in-depth layer, not a correctness guarantee — if the binding
//      isn't wired (e.g. local vitest where miniflare doesn't simulate it,
//      or a future env that hasn't been migrated yet), prefer letting the
//      request through over hard-erroring. Logged so the misconfiguration
//      is observable.
//   2. Match the prior `isRateLimitedPersistent` return-shape semantics
//      (boolean-y "should I return 429?") so call sites change minimally.
//      The wrapper returns `{ allowed: boolean }`; callers check `!allowed`
//      and build their own 429 response (because each caller wants a
//      slightly different shape — text vs JSON).
//
// The companion helper `rateLimitResponse` constructs the 429 in a
// CORS-wrapped, optionally-JSON form so callers don't repeat boilerplate.

import { withCors } from './cors.js';
import { logger } from './logger.js';

/**
 * Check a rate-limit binding for a given key.
 *
 * Fails open: if `binding` is missing/null or its `.limit()` throws, returns
 * `{ allowed: true, fallback: true }` and logs a warning. Callers MUST treat
 * a missing binding as "not rate limited" rather than crashing the request.
 *
 * @param {{ limit: (input: { key: string }) => Promise<{ success: boolean }> } | undefined} binding
 *   The rate-limit binding (e.g. `env.RL_LINKS_CREATE`). Pass `undefined` to
 *   exercise the fail-open path explicitly (useful in tests).
 * @param {string} key - Bucket key. Use a stable per-user/per-resource string.
 * @returns {Promise<{ allowed: boolean, fallback?: boolean, error?: string }>}
 */
export async function checkRateLimit(binding, key) {
	if (!binding || typeof binding.limit !== 'function') {
		// No binding wired up. This is expected in local vitest runs (miniflare
		// doesn't currently expose the ratelimit binding). Don't log every
		// call — that would drown out real signal in dev. The lack of a
		// binding is structurally visible in wrangler.jsonc anyway.
		return { allowed: true, fallback: true };
	}
	try {
		const result = await binding.limit({ key });
		return { allowed: !!result?.success };
	} catch (err) {
		logger.warn('rate_limit_binding_error', { key, error: err?.message });
		return { allowed: true, fallback: true, error: err?.message };
	}
}

/**
 * Build a 429 response. Mirrors the prior in-route boilerplate so callers
 * can swap a single line. Defaults to a plain-text body to match the
 * legacy `new Response('Rate limit exceeded', { status: 429 })`; pass
 * `json: true` to emit a JSON envelope `{ error: 'Rate limit exceeded' }`.
 *
 * @param {object} env - Worker env (for CORS allow-list)
 * @param {Request} request - Incoming request (for CORS Origin echo)
 * @param {object} [options]
 * @param {boolean} [options.json] - Emit JSON body instead of plain text
 * @param {string} [options.message] - Override the human message
 * @returns {Response}
 */
export function rateLimitResponse(env, request, { json = false, message = 'Rate limit exceeded' } = {}) {
	if (json) {
		return withCors(
			env,
			new Response(JSON.stringify({ error: message }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			}),
			request,
		);
	}
	return withCors(env, new Response(message, { status: 429 }), request);
}
