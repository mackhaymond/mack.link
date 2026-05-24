import { dbRun } from './db.js';

/**
 * Stable owner id for a user.
 *
 * B4b (Sprint 2b): owner_id is now just `user.login` (which itself is the
 * full email after the auth.js refactor). Previously this prefixed `gh:`
 * because the pre-Sprint-2a auth was GitHub OAuth — that prefix is now
 * meaningless legacy (the migration 006 renames existing `gh:*` rows).
 *
 * The dev mock user (login='ai-dev', no '@') is still a valid identity;
 * we don't enforce email shape here so test/dev paths keep working with
 * synthetic identifiers.
 */
export function ownerIdForUser(user) {
	if (!user || typeof user.login !== 'string' || !user.login.trim()) {
		throw new Error('user.login required to derive owner_id');
	}
	return user.login.trim();
}

/**
 * Ensure a row exists in `users` for the given user.
 * Called on every authenticated request path so first login lazily provisions.
 *
 * The `github_login` column predates the Access migration — it's kept as a
 * display string (now stores whatever `user.login` happens to be: an email
 * for real users, 'ai-dev' for the dev mock). Renaming the column is a
 * future cleanup.
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
