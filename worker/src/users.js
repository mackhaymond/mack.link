import { dbRun } from './db.js';

/**
 * Stable owner id derived from a user's GitHub login.
 * Format: 'gh:{login}'. Used as users.id and links.owner_id.
 */
export function ownerIdForUser(user) {
	if (!user || typeof user.login !== 'string' || !user.login.trim()) {
		throw new Error('user.login required to derive owner_id');
	}
	return `gh:${user.login.trim()}`;
}

/**
 * Ensure a row exists in `users` for the given GitHub user.
 * Called on every authenticated request path so first login lazily provisions.
 */
export async function ensureUser(env, user) {
	const id = ownerIdForUser(user);
	const now = Date.now();
	await dbRun(
		env,
		`INSERT INTO users (id, github_login, email, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET github_login = excluded.github_login, email = COALESCE(excluded.email, users.email), updated_at = excluded.updated_at`,
		[id, user.login, user.email || null, now, now],
	);
	return id;
}

/**
 * Returns the resolved ownerId (after ensureUser) or throws if user can't be derived.
 */
export async function getOwnerId(env, user) {
	return await ensureUser(env, user);
}
