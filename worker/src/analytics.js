// Analytics using Cloudflare D1 (replaces KV)
import { dbAll, dbGet, dbRun, dbBatch } from './db.js';
import { UAParser } from 'ua-parser-js';

/**
 * M1: Generate a one-way per-day visitor fingerprint.
 * SHA-256 over (IP + UA + day). Never stored as plain PII.
 */
export async function computeVisitorFingerprint(ip, userAgent, day) {
	const data = new TextEncoder().encode(`${ip || ''}|${userAgent || ''}|${day}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * M1: returns true if this fingerprint hasn't been seen for (scope, day).
 * Side-effect: inserts the fingerprint. Called once per dimension scope
 * (link shortcode + _all) per click.
 */
export async function markVisitorIfNew(env, scope, day, fingerprint) {
	const res = await dbRun(
		env,
		`INSERT OR IGNORE INTO visitor_fingerprints (scope, day, fingerprint) VALUES (?, ?, ?)`,
		[scope, day, fingerprint],
	);
	const changes = res?.meta?.changes ?? res?.changes ?? 0;
	return changes > 0;
}

/**
 * Format a timestamp as a UTC-bucket day string YYYYMMDD.
 *
 * M2: UTC-only by design. Per-user timezone bucketing would require
 * shifting at write time (different buckets per visitor) and is deferred.
 * The Admin UI labels timeseries as "UTC" to avoid confusion.
 * TODO(M16): expose timezone-aware buckets if requested.
 */
function formatDay(ts = Date.now()) {
	const d = new Date(ts);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}${m}${day}`;
}

/**
 * H18: delete analytics rows older than `retentionDays` (default 365).
 * Called from the cron handler in index.js. Safe to call multiple times.
 */
export async function purgeOldAnalytics(env, retentionDays = 365) {
	const cutoff = formatDay(Date.now() - retentionDays * 86_400_000);
	await dbRun(env, `DELETE FROM analytics_day WHERE day < ?`, [cutoff]);
	await dbRun(env, `DELETE FROM analytics_day_agg WHERE day < ?`, [cutoff]);
}

/**
 * M6: parse device/browser/OS via ua-parser-js so we correctly attribute
 * Brave, Vivaldi, Samsung Internet, headless Chrome, Edge Chromium, etc.
 * Returns lowercase, stable keys for the analytics_agg dimensions.
 */
export function parseUA(userAgent = '') {
	if (!userAgent) return { device: 'desktop', browser: 'other', os: 'other' };
	const parsed = new UAParser(userAgent).getResult();
	const deviceType = (parsed.device?.type || '').toLowerCase();
	let device = 'desktop';
	if (deviceType === 'mobile' || deviceType === 'wearable') device = 'mobile';
	else if (deviceType === 'tablet') device = 'tablet';
	const browser = (parsed.browser?.name || 'other').toLowerCase().replace(/\s+/g, '_');
	let os = (parsed.os?.name || 'other').toLowerCase();
	if (os.includes('mac')) os = 'macos';
	else if (os.includes('windows')) os = 'windows';
	else if (os.includes('ios')) os = 'ios';
	else if (os.includes('android')) os = 'android';
	else if (os.includes('linux')) os = 'linux';
	return { device, browser, os };
}

/**
 * Extract UTM / click-id parameters from a URL.
 * M5: includes utm_id and the common ad-platform click IDs (gclid, fbclid,
 * msclkid). Each value is capped to 255 chars to bound table key size.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'msclkid'];
const UTM_KEY_MAP = {
	utm_source: 'source',
	utm_medium: 'medium',
	utm_campaign: 'campaign',
	utm_term: 'term',
	utm_content: 'content',
	utm_id: 'utm_id',
	gclid: 'gclid',
	fbclid: 'fbclid',
	msclkid: 'msclkid',
};
function parseUTMParams(url) {
	const utmParams = {};
	try {
		const urlObj = new URL(url);
		const params = urlObj.searchParams;
		for (const key of UTM_KEYS) {
			const value = params.get(key);
			if (value) utmParams[UTM_KEY_MAP[key]] = value.slice(0, 255);
		}
	} catch {}
	return utmParams;
}

/**
 * Extract analytics context from a request
 */
function extractAnalyticsContext(request, shortcode) {
	const userAgent = request.headers.get('User-Agent') || '';
	const ref = request.headers.get('Referer') || '';
	// M4: treat Sec-Fetch-Site: none (direct nav from address bar / bookmarks)
	// and empty Referer as '(direct)'.
	const secFetchSite = (request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
	let refHost = '';
	if (ref) {
		try { refHost = new URL(ref).host; } catch { refHost = ''; }
	}
	if (!refHost && (secFetchSite === 'none' || ref === '')) {
		refHost = '(direct)';
	}

	// Enhanced analytics data from Cloudflare
	const country = (request.cf && request.cf.country) || '??';
	const city = (request.cf && request.cf.city) || '';
	const region = (request.cf && request.cf.region) || '';
	const timezone = (request.cf && request.cf.timezone) || '';

	const { device, browser, os } = parseUA(userAgent);
	const utmParams = parseUTMParams(request.url);
	const day = formatDay();

	return {
		shortcode,
		userAgent,
		refHost,
		country,
		city,
		region,
		timezone,
		device,
		browser,
		os,
		utmParams,
		day,
	};
}

/**
 * Build analytics statements for a given request context
 * Consolidated builder used by both redirect handling and background processing
 */
function buildAnalyticsStatements(context) {
	const { shortcode, refHost, country, city, region, device, browser, os, timezone, utmParams, day } = context;
	const allKey = '_all';
	const statements = [];

	// SQL template for upserts
	const daySQL = `INSERT INTO analytics_day (scope, day, clicks) VALUES (?, ?, ?) ON CONFLICT(scope, day) DO UPDATE SET clicks = analytics_day.clicks + excluded.clicks`;
	const aggSQL = `INSERT INTO analytics_agg (scope, dimension, key, clicks) VALUES (?, ?, ?, ?) ON CONFLICT(scope, dimension, key) DO UPDATE SET clicks = analytics_agg.clicks + excluded.clicks`;
	const dayAggSQL = `INSERT INTO analytics_day_agg (scope, day, dimension, key, clicks) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, day, dimension, key) DO UPDATE SET clicks = analytics_day_agg.clicks + excluded.clicks`;
	const counterSQL = `INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = counters.value + excluded.value`;

	// Per-shortcode daily clicks
	statements.push({ sql: daySQL, bindings: [shortcode, day, 1] });

	// Per-shortcode aggregations
	if (refHost) statements.push({ sql: aggSQL, bindings: [shortcode, 'ref', refHost, 1] });
	statements.push({ sql: aggSQL, bindings: [shortcode, 'country', country, 1] });
	if (city) statements.push({ sql: aggSQL, bindings: [shortcode, 'city', `${city}, ${region || country}`, 1] });
	statements.push({ sql: aggSQL, bindings: [shortcode, 'device', device, 1] });
	statements.push({ sql: aggSQL, bindings: [shortcode, 'browser', browser, 1] });
	statements.push({ sql: aggSQL, bindings: [shortcode, 'os', os, 1] });
	if (timezone) statements.push({ sql: aggSQL, bindings: [shortcode, 'timezone', timezone, 1] });

	// UTM parameters
	if (utmParams.source) statements.push({ sql: aggSQL, bindings: [shortcode, 'utm_source', utmParams.source, 1] });
	if (utmParams.medium) statements.push({ sql: aggSQL, bindings: [shortcode, 'utm_medium', utmParams.medium, 1] });
	if (utmParams.campaign) statements.push({ sql: aggSQL, bindings: [shortcode, 'utm_campaign', utmParams.campaign, 1] });

	// Per-shortcode daily aggregations
	if (refHost) statements.push({ sql: dayAggSQL, bindings: [shortcode, day, 'ref', refHost, 1] });
	statements.push({ sql: dayAggSQL, bindings: [shortcode, day, 'country', country, 1] });
	statements.push({ sql: dayAggSQL, bindings: [shortcode, day, 'device', device, 1] });
	statements.push({ sql: dayAggSQL, bindings: [shortcode, day, 'browser', browser, 1] });
	statements.push({ sql: dayAggSQL, bindings: [shortcode, day, 'os', os, 1] });

	// Global daily clicks
	statements.push({ sql: daySQL, bindings: [allKey, day, 1] });

	// Global aggregations
	if (refHost) statements.push({ sql: aggSQL, bindings: [allKey, 'ref', refHost, 1] });
	statements.push({ sql: aggSQL, bindings: [allKey, 'country', country, 1] });
	if (city) statements.push({ sql: aggSQL, bindings: [allKey, 'city', `${city}, ${region || country}`, 1] });
	statements.push({ sql: aggSQL, bindings: [allKey, 'device', device, 1] });
	statements.push({ sql: aggSQL, bindings: [allKey, 'browser', browser, 1] });
	statements.push({ sql: aggSQL, bindings: [allKey, 'os', os, 1] });

	// Global UTM tracking
	if (utmParams.source) statements.push({ sql: aggSQL, bindings: [allKey, 'utm_source', utmParams.source, 1] });
	if (utmParams.medium) statements.push({ sql: aggSQL, bindings: [allKey, 'utm_medium', utmParams.medium, 1] });
	if (utmParams.campaign) statements.push({ sql: aggSQL, bindings: [allKey, 'utm_campaign', utmParams.campaign, 1] });

	// Global daily aggregations
	if (refHost) statements.push({ sql: dayAggSQL, bindings: [allKey, day, 'ref', refHost, 1] });
	statements.push({ sql: dayAggSQL, bindings: [allKey, day, 'country', country, 1] });
	statements.push({ sql: dayAggSQL, bindings: [allKey, day, 'device', device, 1] });
	statements.push({ sql: dayAggSQL, bindings: [allKey, day, 'browser', browser, 1] });
	statements.push({ sql: dayAggSQL, bindings: [allKey, day, 'os', os, 1] });

	// Global total counter
	statements.push({ sql: counterSQL, bindings: ['analytics:_all:totalClicks', 1] });

	return statements;
}

/**
 * Get analytics statements without executing them.
 * If `uniqueScopes` is supplied (array of scopes for which this visitor is
 * new today, computed by the caller via markVisitorIfNew), the returned
 * statements will also bump unique_clicks. C9 callers compute fingerprints
 * BEFORE building this list so the increments are part of the same batch.
 */
export async function getAnalyticsStatements(env, request, shortcode, destinationUrl = '', requestLogger, { uniqueScopes = [] } = {}) {
	try {
		const context = extractAnalyticsContext(request, shortcode);
		const statements = buildAnalyticsStatements(context);
		const day = context.day;
		const uniqueDaySQL = `UPDATE analytics_day SET unique_clicks = COALESCE(unique_clicks, 0) + 1 WHERE scope = ? AND day = ?`;
		for (const scope of uniqueScopes) {
			statements.push({ sql: uniqueDaySQL, bindings: [scope, day] });
		}
		return statements;
	} catch (error) {
		if (requestLogger) {
			requestLogger.error('Analytics statement generation failed', {
				shortcode,
				error: error.message,
			});
		}
		return [];
	}
}

/**
 * Record a click event with full analytics tracking
 */
export async function recordClick(env, request, shortcode, _destinationUrl = '', requestLogger) {
	let statements;
	try {
		const context = extractAnalyticsContext(request, shortcode);
		statements = buildAnalyticsStatements(context);
		await dbBatch(env, statements);
	} catch (error) {
		requestLogger?.error('Analytics recording failed', {
			shortcode,
			error: error.message,
			statementCount: statements?.length || 0,
		});
		throw error;
	}
}

export async function getTimeseries(env, shortcode, fromISO, toISO) {
	const from = new Date(fromISO);
	const to = new Date(toISO);
	if (isNaN(from) || isNaN(to) || from > to) return { points: [] };
	const scKey = shortcode || '_all';
	const start = formatDay(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
	const end = formatDay(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
	const rows = await dbAll(
		env,
		`SELECT day, clicks, COALESCE(unique_clicks, 0) AS unique_clicks FROM analytics_day WHERE scope = ? AND day >= ? AND day <= ? ORDER BY day ASC`,
		[scKey, start, end],
	);
	const map = new Map(rows.map((r) => [r.day, r]));
	const points = [];
	const startMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
	const endMs = to.getTime();
	for (let ts = startMs; ts <= endMs; ts += 86_400_000) {
		const k = formatDay(ts);
		const row = map.get(k);
		points.push({
			date: new Date(ts).toISOString().slice(0, 10),
			clicks: row?.clicks || 0,
			uniqueClicks: row?.unique_clicks || 0,
		});
	}
	return { points };
}

// Returns time series per shortcode for the top N links in the date range
export async function getTimeseriesByLinks(env, fromISO, toISO, limit = 5) {
	const from = new Date(fromISO);
	const to = new Date(toISO);
	if (isNaN(from) || isNaN(to) || from > to) return { labels: [], series: [] };
	const start = formatDay(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
	const end = formatDay(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

	// Top N shortcodes by clicks in the window (exclude global scope)
	const topRows = await dbAll(
		env,
		`SELECT scope AS shortcode, SUM(clicks) AS total
		 FROM analytics_day
		 WHERE scope != '_all' AND day >= ? AND day <= ?
		 GROUP BY scope
		 ORDER BY total DESC
		 LIMIT ?`,
		[start, end, limit],
	);
	if (!topRows.length) return { labels: [], series: [] };
	const shortcodes = topRows.map((r) => r.shortcode);

	// Fetch all rows for these shortcodes in a single query
	const placeholders = shortcodes.map(() => '?').join(',');
	const rows = await dbAll(
		env,
		`SELECT scope AS shortcode, day, clicks
		 FROM analytics_day
		 WHERE scope IN (${placeholders}) AND day >= ? AND day <= ?
		 ORDER BY day ASC`,
		[...shortcodes, start, end],
	);

	// M3: iterate by timestamp instead of mutating a Date object.
	const labels = [];
	const startMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
	const endMs = to.getTime();
	for (let ts = startMs; ts <= endMs; ts += 86_400_000) {
		labels.push(new Date(ts).toISOString().slice(0, 10));
	}

	// Index rows per shortcode/day
	const byShortcode = new Map(shortcodes.map((sc) => [sc, new Map()]));
	for (const r of rows) {
		const m = byShortcode.get(r.shortcode);
		if (m) m.set(r.day, r.clicks);
	}

	const series = shortcodes.map((sc) => {
		const m = byShortcode.get(sc) || new Map();
		const values = labels.map((iso) => m.get(iso.replace(/-/g, '')) || 0);
		const total = values.reduce((a, b) => a + b, 0);
		return { shortcode: sc, total, values };
	});

	return { labels, series };
}

export async function getBreakdown(env, shortcode, dimension, limit = 10, fromISO, toISO) {
	const scKey = shortcode || '_all';
	if (fromISO && toISO) {
		const from = new Date(fromISO);
		const to = new Date(toISO);
		if (!isNaN(from) && !isNaN(to) && from <= to) {
			const start = formatDay(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
			const end = formatDay(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
			const rows = await dbAll(
				env,
				`SELECT key, SUM(clicks) AS clicks
				 FROM analytics_day_agg
				 WHERE scope = ? AND dimension = ? AND day >= ? AND day <= ?
				 GROUP BY key
				 ORDER BY clicks DESC
				 LIMIT ?`,
				[scKey, dimension, start, end, limit],
			);
			return { items: rows.map((r) => ({ key: r.key, clicks: r.clicks || 0 })) };
		}
	}
	const rows = await dbAll(env, `SELECT key, clicks FROM analytics_agg WHERE scope = ? AND dimension = ? ORDER BY clicks DESC LIMIT ?`, [
		scKey,
		dimension,
		limit,
	]);
	return { items: rows.map((r) => ({ key: r.key, clicks: r.clicks || 0 })) };
}

export async function getOverview(env, shortcode) {
	// Per-shortcode: use stored clicks as total. Global: use running counter.
	let total = 0;
	if (shortcode) {
		const row = await dbGet(env, `SELECT clicks FROM links WHERE shortcode = ?`, [shortcode]);
		total = row?.clicks || 0;
	} else {
		const row = await dbGet(env, `SELECT value FROM counters WHERE name = ?`, ['analytics:_all:totalClicks']);
		total = parseInt(row?.value || '0', 10) || 0;
	}
	const scKey = shortcode || '_all';
	const todayRow = await dbGet(
		env,
		`SELECT clicks, COALESCE(unique_clicks, 0) AS unique_clicks FROM analytics_day WHERE scope = ? AND day = ?`,
		[scKey, formatDay()],
	);
	const today = todayRow?.clicks || 0;
	const uniqueToday = todayRow?.unique_clicks || 0;

	const sevenDaysAgo = formatDay(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const trendRows = await dbAll(
		env,
		`SELECT day, clicks, COALESCE(unique_clicks, 0) AS unique_clicks FROM analytics_day WHERE scope = ? AND day >= ? ORDER BY day ASC`,
		[scKey, sevenDaysAgo],
	);

	const weeklyTotal = trendRows.reduce((sum, row) => sum + row.clicks, 0);
	const weeklyUnique = trendRows.reduce((sum, row) => sum + (row.unique_clicks || 0), 0);
	const averageDaily = weeklyTotal > 0 ? Math.round((weeklyTotal / 7) * 100) / 100 : 0;

	return {
		totalClicks: total,
		clicksToday: today,
		uniqueClicksToday: uniqueToday,
		weeklyTotal,
		weeklyUnique,
		averageDaily,
		trend: trendRows,
	};
}

export async function exportAnalytics(env, shortcode, fromISO, toISO, format = 'json') {
	const scKey = shortcode || '_all';
	const from = new Date(fromISO);
	const to = new Date(toISO);

	if (isNaN(from) || isNaN(to) || from > to) {
		throw new Error('Invalid date range');
	}

	const start = formatDay(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
	const end = formatDay(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

	// Get timeseries data
	const timeseries = await getTimeseries(env, shortcode, fromISO, toISO);

	// Get breakdown data for multiple dimensions
	const dimensions = ['ref', 'country', 'device', 'browser', 'os', 'utm_source', 'utm_medium', 'utm_campaign'];
	const breakdowns = {};

	for (const dimension of dimensions) {
		breakdowns[dimension] = await getBreakdown(env, shortcode, dimension, 20, fromISO, toISO);
	}

	const overview = await getOverview(env, shortcode);

	const exportData = {
		scope: shortcode ? `shortcode:${shortcode}` : 'global',
		dateRange: { from: fromISO, to: toISO },
		overview,
		timeseries,
		breakdowns,
		exportedAt: new Date().toISOString(),
	};

	return exportData;
}
