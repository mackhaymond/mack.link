// Cloudflare Access-aware auth service.
//
// Sprint 2a (A3): the SPA no longer runs OAuth. Cloudflare Access has
// already authenticated the user before they ever reach this React app -
// the worker just verifies the Cf-Access-Jwt-Assertion header on API
// requests. The SPA reads identity from `/cdn-cgi/access/get-identity`
// (handled by Cloudflare directly, not by the worker).
//
// In `npm run dev:ai` mode (VITE_AUTH_DISABLED=true), Access doesn't
// intercept localhost - we return a hardcoded mock identity so the
// admin UI renders without round-tripping anywhere.

const STORAGE_KEY = 'mack-link.user';
const DEV_MODE = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AUTH_DISABLED === 'true';
const DEV_USER = { login: 'ai-dev', email: 'ai-dev@localhost', name: 'AI Developer', avatar_url: '' };

let cachedUser = null;
let inflight = null;

function readSessionStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionStorage(user) {
  try {
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* sessionStorage may be unavailable (private mode, etc.) */ }
}

async function fetchIdentity() {
  if (DEV_MODE) return DEV_USER;
  try {
    const r = await fetch('/cdn-cgi/access/get-identity', { credentials: 'include' });
    if (!r.ok) return null;
    const identity = await r.json();
    const email = String(identity.email || '');
    const login = email.includes('@') ? email.split('@')[0] : (identity.user_uuid || 'user');
    return {
      login,
      email,
      name: identity.name || email || login,
      avatar_url: '',
    };
  } catch {
    return null;
  }
}

export const authService = {
  // Synchronous accessor for components that already have a hydrated state
  // (e.g. Header reads from a prop now, but keep this for compatibility
  // with any future callsite that needs the last-known identity).
  getUser() {
    if (cachedUser) return cachedUser;
    const fromStorage = readSessionStorage();
    if (fromStorage) cachedUser = fromStorage;
    return cachedUser;
  },

  // Async resolver: returns the current identity or null. De-duplicates
  // concurrent calls (App + Header both mounting at the same tick).
  async resolveUser() {
    if (cachedUser) return cachedUser;
    if (inflight) return inflight;
    inflight = fetchIdentity().then((user) => {
      cachedUser = user;
      writeSessionStorage(user);
      inflight = null;
      return user;
    });
    return inflight;
  },

  isAuthenticated() {
    return !!cachedUser;
  },

  logout() {
    cachedUser = null;
    writeSessionStorage(null);
    // Cloudflare clears the Access session cookie and bounces the user
    // back to the team login page. In dev mode this 404s harmlessly
    // (Access isn't running locally) - reload to reset SPA state.
    if (DEV_MODE) {
      window.location.reload();
      return;
    }
    window.location.href = '/cdn-cgi/access/logout';
  },
};
