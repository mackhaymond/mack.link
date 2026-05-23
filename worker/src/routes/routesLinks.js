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

export async function getAllLinks(env, request, ownerId) {
	const rows = await dbAll(
		env,
		`SELECT ${LINK_PUBLIC_COLUMNS} FROM links WHERE owner_id = ? ORDER BY shortcode ASC LIMIT ?`,
		[ownerId, GET_ALL_LINKS_CAP + 1],
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

export async function createLink(request, env, ownerId) {
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

		// C6: shortcodes are globally unique (PRIMARY KEY). Don't leak ownership of
		// taken shortcodes - return the same 409 regardless of who owns it.
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
			`INSERT INTO links (shortcode, owner_id, url, description, redirect_type, tags, archived, activates_at, expires_at, password_hash, password_enabled, created, updated, clicks, last_clicked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			[
				shortcode,
				ownerId,
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

export async function updateLink(request, env, shortcode, ownerId) {
	try {
		// C6: filter by owner_id. Return 404 (not 403) when the link belongs to
		// someone else to avoid leaking existence.
		const row = await dbGet(
			env,
			`SELECT shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked, password_enabled FROM links WHERE shortcode = ? AND owner_id = ?`,
			[shortcode, ownerId],
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
				? `UPDATE links SET url = ?, description = ?, redirect_type = ?, tags = ?, archived = ?, activates_at = ?, expires_at = ?, password_hash = ?, password_enabled = ?, updated = ? WHERE shortcode = ? AND owner_id = ?`
				: `UPDATE links SET url = ?, description = ?, redirect_type = ?, tags = ?, archived = ?, activates_at = ?, expires_at = ?, updated = ? WHERE shortcode = ? AND owner_id = ?`;

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
						ownerId,
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
						ownerId,
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

export async function deleteLink(env, shortcode, request, ownerId) {
	// C6: only return / delete when the requester owns the link. 404 (not 403)
	// for not-yours so we don't leak existence.
	const existing = await dbGet(env, `SELECT shortcode FROM links WHERE shortcode = ? AND owner_id = ?`, [shortcode, ownerId]);
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
	await dbRun(env, `DELETE FROM links WHERE shortcode = ? AND owner_id = ?`, [shortcode, ownerId]);
	return withCors(env, new Response(null, { status: 204 }), request);
}

export async function bulkDeleteLinks(request, env, ownerId) {
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
		// H15: replace N+1 with a single SELECT and a single DELETE.
		// Both queries filter by owner_id (C6) so users can never bulk-delete
		// each other's links.
		const placeholders = shortcodes.map(() => '?').join(',');
		const existingRows = await dbAll(
			env,
			`SELECT shortcode FROM links WHERE shortcode IN (${placeholders}) AND owner_id = ?`,
			[...shortcodes, ownerId],
		);
		const existingSet = new Set(existingRows.map((r) => r.shortcode));
		const toDelete = shortcodes.filter((sc) => existingSet.has(sc));
		const notFound = shortcodes.filter((sc) => !existingSet.has(sc));
		const results = { deleted: [], notFound, errors: [] };
		if (toDelete.length > 0) {
			try {
				const delPlaceholders = toDelete.map(() => '?').join(',');
				await dbRun(
					env,
					`DELETE FROM links WHERE shortcode IN (${delPlaceholders}) AND owner_id = ?`,
					[...toDelete, ownerId],
				);
				results.deleted = toDelete;
			} catch (error) {
				results.errors = toDelete.map((sc) => ({ shortcode: sc, error: error.message }));
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

export async function getLink(env, shortcode, request, ownerId) {
	const r = await dbGet(
		env,
		`SELECT shortcode, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked FROM links WHERE shortcode = ? AND owner_id = ?`,
		[shortcode, ownerId],
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

export async function bulkCreateLinks(request, env, ownerId) {
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
		// H15: validate all items, then issue one batched INSERT-OR-IGNORE and a
		// single follow-up SELECT to detect which inserts conflicted.
		const results = { created: [], conflicts: [], errors: [] };
		const valid = [];
		for (const item of items) {
			let { shortcode, url, description = '', redirectType = 301 } = item || {};
			shortcode = sanitizeInput(shortcode);
			url = sanitizeInput(url);
			description = sanitizeInput(description);
			const shortcodeError = validateShortcode(shortcode);
			if (shortcodeError) { results.errors.push({ shortcode, error: shortcodeError }); continue; }
			const urlError = validateUrl(url);
			if (urlError) { results.errors.push({ shortcode, error: urlError }); continue; }
			const descriptionError = validateDescription(description);
			if (descriptionError) { results.errors.push({ shortcode, error: descriptionError }); continue; }
			const redirectTypeError = validateRedirectType(redirectType);
			if (redirectTypeError) { results.errors.push({ shortcode, error: redirectTypeError }); continue; }
			valid.push({
				shortcode,
				url: url.trim(),
				description: description ? description.trim() : '',
				redirectType: redirectType || 301,
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				clicks: 0,
			});
		}

		if (valid.length > 0) {
			const { dbBatch } = await import('../db.js');
			try {
				await dbBatch(
					env,
					valid.map((v) => ({
						sql: `INSERT OR IGNORE INTO links (shortcode, owner_id, url, description, redirect_type, tags, archived, activates_at, expires_at, created, updated, clicks, last_clicked) VALUES (?, ?, ?, ?, ?, '[]', 0, NULL, NULL, ?, ?, 0, NULL)`,
						bindings: [v.shortcode, ownerId, v.url, v.description, v.redirectType, v.created, v.updated],
					})),
				);
				// Detect which actually inserted: anything still present in DB owned by this user is created.
				// Anything in `valid` but missing from owner's rows conflicted (already existed under another owner or same).
				const placeholders = valid.map(() => '?').join(',');
				const ownedRows = await dbAll(
					env,
					`SELECT shortcode FROM links WHERE shortcode IN (${placeholders}) AND owner_id = ?`,
					[...valid.map((v) => v.shortcode), ownerId],
				);
				const ownedSet = new Set(ownedRows.map((r) => r.shortcode));
				for (const v of valid) {
					if (ownedSet.has(v.shortcode)) results.created.push(v);
					else results.conflicts.push(v.shortcode);
				}
			} catch (err) {
				for (const v of valid) results.errors.push({ shortcode: v.shortcode, error: err.message });
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

export async function listLinks(env, request, ownerId) {
	const url = new URL(request.url);
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
	const cursor = url.searchParams.get('cursor') || null;
	const rows = await dbAll(
		env,
		cursor
			? `SELECT ${LINK_PUBLIC_COLUMNS} FROM links WHERE owner_id = ? AND shortcode > ? ORDER BY shortcode ASC LIMIT ?`
			: `SELECT ${LINK_PUBLIC_COLUMNS} FROM links WHERE owner_id = ? ORDER BY shortcode ASC LIMIT ?`,
		cursor ? [ownerId, cursor, limit + 1] : [ownerId, limit + 1],
	);
	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const links = {};
	for (const r of pageRows) links[r.shortcode] = rowToLink(r);
	const nextCursor = hasMore ? pageRows[pageRows.length - 1].shortcode : null;
	const body = { links, cursor: nextCursor };
	return withCors(env, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }), request);
}
