import { withCors } from '../cors.js';
import { sanitizeInput, isRateLimitedPersistent } from '../utils.js';
import { validateShortcode, validateUrl, validateDescription, validateRedirectType, validateTags, validateISODate } from '../validation.js';
import { dbAll, dbGet, dbRun } from '../db.js';
import { getConfig } from '../config.js';
import { createPasswordHash, validatePasswordStrength } from '../password.js';

// C13: explicit column list (never SELECT *, so password_hash can never leak)
// and capped result count to bound response size.
const LINK_PUBLIC_COLUMNS = `shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked, password_enabled`;
const GET_ALL_LINKS_CAP = 500;

function rowToLink(r) {
	return {
		url: r.url,
		description: r.description || '',
		redirectType: r.redirect_type || 301,
		tags: safeParseJsonArray(r.tags),
		archived: !!r.archived,
		activatesAt: r.activates_at || null,
		expiresAt: r.expires_at || null,
		created: r.created,
		updated: r.updated,
		clicks: r.clicks || 0,
		lastClicked: r.last_clicked || null,
		passwordEnabled: !!r.password_enabled,
	};
}

export async function getAllLinks(env, request) {
	const rows = await dbAll(
		env,
		`SELECT ${LINK_PUBLIC_COLUMNS} FROM links ORDER BY shortcode ASC LIMIT ?`,
		[GET_ALL_LINKS_CAP + 1],
	);
	const truncated = rows.length > GET_ALL_LINKS_CAP;
	const page = truncated ? rows.slice(0, GET_ALL_LINKS_CAP) : rows;
	const links = {};
	for (const r of page) links[r.shortcode] = rowToLink(r);
	const headers = { 'Content-Type': 'application/json' };
	if (truncated) {
		headers['Link'] = '</api/links?limit=500&cursor=' + encodeURIComponent(page[page.length - 1].shortcode) + '>; rel="next"';
	}
	return withCors(env, new Response(JSON.stringify(links), { headers }), request);
}

function safeParseJsonArray(text) {
	if (!text) return [];
	try {
		const v = JSON.parse(text);
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

export async function createLink(request, env) {
	try {
		const { rateLimits } = getConfig(env);
		if (
			await isRateLimitedPersistent(env, request, {
				key: 'create',
				limit: Number(rateLimits.createPerHour || 50),
				windowMs: Number(rateLimits.windowMs || 3600000),
			})
		) {
			return withCors(env, new Response('Rate limit exceeded', { status: 429 }), request);
		}
		const body = await request.json();
		let { shortcode, url, description, redirectType, tags, archived, activatesAt, expiresAt, password } = body;
		shortcode = sanitizeInput(shortcode);
		url = sanitizeInput(url);
		description = sanitizeInput(description);
		if (Array.isArray(tags)) tags = tags.map(sanitizeInput);
		const shortcodeError = validateShortcode(shortcode);
		if (shortcodeError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: shortcodeError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const urlError = validateUrl(url);
		if (urlError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: urlError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const descriptionError = validateDescription(description);
		if (descriptionError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: descriptionError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const redirectTypeError = validateRedirectType(redirectType);
		if (redirectTypeError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: redirectTypeError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const tagsError = validateTags(tags);
		if (tagsError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: tagsError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const activatesAtError = validateISODate(activatesAt);
		if (activatesAtError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: activatesAtError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const expiresAtError = validateISODate(expiresAt);
		if (expiresAtError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: expiresAtError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);

		// Validate password if provided
		let passwordHash = null;
		let passwordEnabled = false;
		if (password && typeof password === 'string' && password.trim()) {
			const passwordValidation = validatePasswordStrength(password);
			if (!passwordValidation.valid) {
				return withCors(
					env,
					new Response(JSON.stringify({ error: passwordValidation.errors[0] }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}),
					request,
				);
			}
			passwordHash = await createPasswordHash(password);
			passwordEnabled = true;
		}

		const existing = await dbGet(env, `SELECT shortcode FROM links WHERE shortcode = ?`, [shortcode]);
		if (existing)
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Shortcode already exists' }), {
					status: 409,
					headers: { 'Content-Type': 'application/json' },
				}),
				request,
			);
		const linkData = {
			url: url.trim(),
			description: description ? description.trim() : '',
			redirectType: redirectType || 301,
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
			clicks: 0,
			tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
			archived: !!archived,
			activatesAt: activatesAt || null,
			expiresAt: expiresAt || null,
			passwordEnabled,
			passwordHash,
		};
		await dbRun(
			env,
			`INSERT INTO links (shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, password_hash, password_enabled, created, updated, clicks, last_clicked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			[
				shortcode,
				linkData.url,
				linkData.description,
				linkData.redirectType,
				JSON.stringify(linkData.tags),
				linkData.archived ? 1 : 0,
				linkData.activatesAt,
				linkData.expiresAt,
				linkData.passwordHash,
				linkData.passwordEnabled ? 1 : 0,
				linkData.created,
				linkData.updated,
				0,
			],
		);
		return withCors(
			env,
			new Response(JSON.stringify({ shortcode, ...linkData }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
			request,
		);
	} catch (error) {
		return withCors(
			env,
			new Response(JSON.stringify({ error: 'Invalid request data' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
			request,
		);
	}
}

export async function updateLink(request, env, shortcode) {
	try {
		const row = await dbGet(
			env,
			`SELECT shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked, password_enabled FROM links WHERE shortcode = ?`,
			[shortcode],
		);
		if (!row) return withCors(env, new Response('Link not found', { status: 404 }), request);
		const currentData = {
			url: row.url,
			description: row.description || '',
			redirectType: row.redirect_type || 301,
			tags: safeParseJsonArray(row.tags),
			archived: !!row.archived,
			activatesAt: row.activates_at || null,
			expiresAt: row.expires_at || null,
			created: row.created,
			updated: row.updated,
			clicks: row.clicks || 0,
			lastClicked: row.last_clicked || null,
			passwordEnabled: !!row.password_enabled,
		};
		const { rateLimits } = getConfig(env);
		if (
			await isRateLimitedPersistent(env, request, {
				key: 'update',
				limit: Number(rateLimits.updatePerHour || 200),
				windowMs: Number(rateLimits.windowMs || 3600000),
			})
		) {
			return withCors(env, new Response('Rate limit exceeded', { status: 429 }), request);
		}
		const updates = await request.json();
		let { url, description, redirectType, tags, archived, activatesAt, expiresAt, password } = updates;
		if (url !== undefined) url = sanitizeInput(url);
		if (description !== undefined) description = sanitizeInput(description);
		if (Array.isArray(tags)) tags = tags.map(sanitizeInput);
		const urlError = url !== undefined ? validateUrl(url) : null;
		if (urlError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: urlError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const descriptionError = description !== undefined ? validateDescription(description) : null;
		if (descriptionError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: descriptionError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const redirectTypeError = redirectType !== undefined ? validateRedirectType(redirectType) : null;
		if (redirectTypeError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: redirectTypeError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const tagsError = tags !== undefined ? validateTags(tags) : null;
		if (tagsError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: tagsError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const activatesAtError = activatesAt !== undefined ? validateISODate(activatesAt) : null;
		if (activatesAtError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: activatesAtError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		const expiresAtError = expiresAt !== undefined ? validateISODate(expiresAt) : null;
		if (expiresAtError)
			return withCors(
				env,
				new Response(JSON.stringify({ error: expiresAtError }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
				request,
			);

		// Handle password updates
		let passwordHash = undefined;
		let passwordEnabled = undefined;
		if (password !== undefined) {
			if (password === null || password === '') {
				// Remove password protection
				passwordHash = null;
				passwordEnabled = false;
			} else if (typeof password === 'string' && password.trim()) {
				// Set or update password
				const passwordValidation = validatePasswordStrength(password);
				if (!passwordValidation.valid) {
					return withCors(
						env,
						new Response(JSON.stringify({ error: passwordValidation.errors[0] }), {
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						}),
						request,
					);
				}
				passwordHash = await createPasswordHash(password);
				passwordEnabled = true;
			}
		}

		const linkData = {
			...currentData,
			...(url !== undefined ? { url: url.trim() } : {}),
			...(description !== undefined ? { description: description ? description.trim() : '' } : {}),
			...(redirectType !== undefined ? { redirectType } : {}),
			...(tags !== undefined ? { tags: Array.isArray(tags) ? tags.filter(Boolean) : [] } : {}),
			...(archived !== undefined ? { archived: !!archived } : {}),
			...(activatesAt !== undefined ? { activatesAt: activatesAt || null } : {}),
			...(expiresAt !== undefined ? { expiresAt: expiresAt || null } : {}),
			...(passwordEnabled !== undefined ? { passwordEnabled } : {}),
			updated: new Date().toISOString(),
		};
		const sql =
			passwordHash !== undefined
				? `UPDATE links SET url = ?, description = ?, redirect_type = ?, tags = ?, archived = ?, activates_at = ?, expires_at = ?, password_hash = ?, password_enabled = ?, updated = ? WHERE shortcode = ?`
				: `UPDATE links SET url = ?, description = ?, redirect_type = ?, tags = ?, archived = ?, activates_at = ?, expires_at = ?, updated = ? WHERE shortcode = ?`;

		const params =
			passwordHash !== undefined
				? [
						linkData.url,
						linkData.description,
						linkData.redirectType,
						JSON.stringify(linkData.tags),
						linkData.archived ? 1 : 0,
						linkData.activatesAt,
						linkData.expiresAt,
						passwordHash,
						linkData.passwordEnabled ? 1 : 0,
						linkData.updated,
						shortcode,
					]
				: [
						linkData.url,
						linkData.description,
						linkData.redirectType,
						JSON.stringify(linkData.tags),
						linkData.archived ? 1 : 0,
						linkData.activatesAt,
						linkData.expiresAt,
						linkData.updated,
						shortcode,
					];

		await dbRun(env, sql, params);
		return withCors(
			env,
			new Response(JSON.stringify({ shortcode, ...linkData }), { headers: { 'Content-Type': 'application/json' } }),
			request,
		);
	} catch (error) {
		return withCors(env, new Response('Invalid JSON', { status: 400 }), request);
	}
}

export async function deleteLink(env, shortcode, request) {
	const existing = await dbGet(env, `SELECT shortcode FROM links WHERE shortcode = ?`, [shortcode]);
	if (!existing) return withCors(env, new Response('Link not found', { status: 404 }), request);
	const { rateLimits } = getConfig(env);
	if (
		await isRateLimitedPersistent(env, request, {
			key: 'delete',
			limit: Number(rateLimits.deletePerHour || 200),
			windowMs: Number(rateLimits.windowMs || 3600000),
		})
	) {
		return withCors(env, new Response('Rate limit exceeded', { status: 429 }), request);
	}
	await dbRun(env, `DELETE FROM links WHERE shortcode = ?`, [shortcode]);
	return withCors(env, new Response(null, { status: 204 }), request);
}

export async function bulkDeleteLinks(request, env) {
	try {
		const { rateLimits } = getConfig(env);
		if (
			await isRateLimitedPersistent(env, request, {
				key: 'bulkDelete',
				limit: Number(rateLimits.bulkDeletePerHour || 50),
				windowMs: Number(rateLimits.windowMs || 3600000),
			})
		) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		}
		const { shortcodes } = await request.json();
		if (!Array.isArray(shortcodes) || shortcodes.length === 0) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Shortcodes array is required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}),
				request,
			);
		}
		if (shortcodes.length > 100) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Cannot delete more than 100 links at once' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}),
				request,
			);
		}
		for (const sc of shortcodes) {
			const error = validateShortcode(sc);
			if (error) {
				return withCors(
					env,
					new Response(JSON.stringify({ error: `Invalid shortcode \"${sc}\": ${error}` }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					}),
					request,
				);
			}
		}
		const results = { deleted: [], notFound: [], errors: [] };
		for (const sc of shortcodes) {
			try {
				const existing = await dbGet(env, `SELECT shortcode FROM links WHERE shortcode = ?`, [sc]);
				if (!existing) {
					results.notFound.push(sc);
					continue;
				}
				await dbRun(env, `DELETE FROM links WHERE shortcode = ?`, [sc]);
				results.deleted.push(sc);
			} catch (error) {
				results.errors.push({ shortcode: sc, error: error.message });
			}
		}
		return withCors(
			env,
			new Response(
				JSON.stringify({
					message: `Bulk delete completed: ${results.deleted.length} deleted, ${results.notFound.length} not found, ${results.errors.length} errors`,
					results,
				}),
				{ headers: { 'Content-Type': 'application/json' } },
			),
			request,
		);
	} catch (error) {
		return withCors(
			env,
			new Response(JSON.stringify({ error: 'Invalid request data' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
			request,
		);
	}
}

export async function getLink(env, shortcode, request) {
	const r = await dbGet(
		env,
		`SELECT shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked FROM links WHERE shortcode = ?`,
		[shortcode],
	);
	if (!r) return withCors(env, new Response('Link not found', { status: 404 }), request);
	const linkData = {
		url: r.url,
		description: r.description || '',
		redirectType: r.redirect_type || 301,
		tags: safeParseJsonArray(r.tags),
		archived: !!r.archived,
		activatesAt: r.activates_at || null,
		expiresAt: r.expires_at || null,
		created: r.created,
		updated: r.updated,
		clicks: r.clicks || 0,
		lastClicked: r.last_clicked || null,
	};
	return withCors(env, new Response(JSON.stringify(linkData), { headers: { 'Content-Type': 'application/json' } }), request);
}

export async function bulkCreateLinks(request, env) {
	try {
		const { rateLimits } = getConfig(env);
		if (
			await isRateLimitedPersistent(env, request, {
				key: 'bulkCreate',
				limit: Number(rateLimits.bulkCreatePerHour || 50),
				windowMs: Number(rateLimits.windowMs || 3600000),
			})
		) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
				request,
			);
		}
		const { items } = await request.json();
		if (!Array.isArray(items) || items.length === 0) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Items array is required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}),
				request,
			);
		}
		if (items.length > 100) {
			return withCors(
				env,
				new Response(JSON.stringify({ error: 'Cannot create more than 100 links at once' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				}),
				request,
			);
		}
		const results = { created: [], conflicts: [], errors: [] };
		for (const item of items) {
			try {
				let { shortcode, url, description = '', redirectType = 301 } = item;
				shortcode = sanitizeInput(shortcode);
				url = sanitizeInput(url);
				description = sanitizeInput(description);
				const shortcodeError = validateShortcode(shortcode);
				if (shortcodeError) {
					results.errors.push({ shortcode, error: shortcodeError });
					continue;
				}
				const urlError = validateUrl(url);
				if (urlError) {
					results.errors.push({ shortcode, error: urlError });
					continue;
				}
				const descriptionError = validateDescription(description);
				if (descriptionError) {
					results.errors.push({ shortcode, error: descriptionError });
					continue;
				}
				const redirectTypeError = validateRedirectType(redirectType);
				if (redirectTypeError) {
					results.errors.push({ shortcode, error: redirectTypeError });
					continue;
				}
				const existing = await dbGet(env, `SELECT shortcode FROM links WHERE shortcode = ?`, [shortcode]);
				if (existing) {
					results.conflicts.push(shortcode);
					continue;
				}
				const linkData = {
					url: url.trim(),
					description: description ? description.trim() : '',
					redirectType: redirectType || 301,
					created: new Date().toISOString(),
					updated: new Date().toISOString(),
					clicks: 0,
				};
				await dbRun(
					env,
					`INSERT INTO links (shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked) VALUES (?, ?, ?, ?, '[]', 0, NULL, NULL, ?, ?, 0, NULL)`,
					[shortcode, linkData.url, linkData.description, linkData.redirectType, linkData.created, linkData.updated],
				);
				results.created.push({ shortcode, ...linkData });
			} catch (err) {
				results.errors.push({ shortcode: item?.shortcode, error: err.message });
			}
		}
		return withCors(env, new Response(JSON.stringify(results), { status: 207, headers: { 'Content-Type': 'application/json' } }), request);
	} catch (error) {
		return withCors(
			env,
			new Response(JSON.stringify({ error: 'Invalid request data' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
			request,
		);
	}
}

export async function listLinks(env, request) {
	const url = new URL(request.url);
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
	const cursor = url.searchParams.get('cursor') || null;
	const rows = await dbAll(
		env,
		cursor
			? `SELECT ${LINK_PUBLIC_COLUMNS} FROM links WHERE shortcode > ? ORDER BY shortcode ASC LIMIT ?`
			: `SELECT ${LINK_PUBLIC_COLUMNS} FROM links ORDER BY shortcode ASC LIMIT ?`,
		cursor ? [cursor, limit + 1] : [limit + 1],
	);
	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const links = {};
	for (const r of pageRows) links[r.shortcode] = rowToLink(r);
	const nextCursor = hasMore ? pageRows[pageRows.length - 1].shortcode : null;
	const body = { links, cursor: nextCursor };
	return withCors(env, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }), request);
}
