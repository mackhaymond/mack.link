import { createHttpClient } from '@mack-link/shared';
import { authService } from './auth.js';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const AUTH_DISABLED = import.meta?.env?.VITE_AUTH_DISABLED === 'true';

/**
 * Shared HTTP client with dev-auth support.
 *
 * H9: on 401/403 we no longer hard-reload the page (which drops any
 * in-progress form state). Instead we clear local auth state and emit
 * `auth:unauthenticated`, which App.jsx listens for to route to LoginScreen.
 * Components that need to preserve form data can persist to sessionStorage
 * keyed on form name when they see this event.
 */
export const http = createHttpClient({
  apiBase: API_BASE,
  authDisabled: AUTH_DISABLED,
  onUnauthorized: () => {
    authService.logout();
    window.dispatchEvent(new CustomEvent('auth:unauthenticated'));
  },
});
