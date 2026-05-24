import { createHttpClient } from '@mack-link/shared';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const AUTH_DISABLED = import.meta?.env?.VITE_AUTH_DISABLED === 'true';

// Sprint 2a (A3): on 401 from the API, Cloudflare Access has either
// expired the user's session or never authenticated them. Either way,
// the in-app login flow is gone - the only path back is to bounce
// through Access logout (which clears the stale cookie if any and
// re-prompts for sign-in on the next /admin request).
//
// In dev:ai mode, /cdn-cgi/access/logout 404s harmlessly (Access is not
// running locally); a 401 in dev means the Worker explicitly rejected
// the request (e.g. AUTH_DISABLED wasn't actually set). Reload the
// page to surface the courtesy "Sign in" UI from App.jsx.
export const http = createHttpClient({
  apiBase: API_BASE,
  authDisabled: AUTH_DISABLED,
  onUnauthorized: () => {
    if (AUTH_DISABLED) {
      window.location.reload();
      return;
    }
    window.location.href = '/cdn-cgi/access/logout';
  },
});
