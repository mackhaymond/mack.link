const API_BASE = import.meta.env.VITE_API_BASE || ''

class AuthService {
  constructor() {
    this.token = null // no longer used client-side
    this.user = JSON.parse(localStorage.getItem('user') || 'null')
    window.addEventListener('storage', (e) => {
      if (e.key === 'user') {
        const userRaw = localStorage.getItem('user')
        this.user = userRaw ? JSON.parse(userRaw) : null
        const event = new CustomEvent('auth:change', {
          detail: { token: this.token, user: this.user },
        })
        window.dispatchEvent(event)
      }
    })

    // Zero-click dev auth: when VITE_AUTH_DISABLED=true, auto-fetch user from the Worker
    // This avoids any cookie requirements and works even when third-party cookies are blocked
    this.bootstrapDevAuthIfNeeded()
  }

  isAuthenticated() {
    return !!this.user
  }

  getToken() {
    return this.token
  }

  getUser() {
    return this.user
  }

  async bootstrapDevAuthIfNeeded() {
    try {
      const dev = import.meta?.env?.VITE_AUTH_DISABLED === 'true'
      if (!dev || this.user) return
      const base = API_BASE || window.location.origin
      const resp = await fetch(new URL('/api/user', base).toString(), {
        credentials: 'include',
        headers: { 'x-dev-auth': '1' },
      })
      if (resp.ok) {
        const data = await resp.json()
        this.user = data?.user || data
        if (this.user) {
          localStorage.setItem('user', JSON.stringify(this.user))
          const event = new CustomEvent('auth:change', { detail: { token: this.token, user: this.user } })
          window.dispatchEvent(event)
        }
      }
    } catch (e) {
      // Non-fatal during dev startup
      console.warn('Dev auto-auth bootstrap failed', e)
    }
  }

  async login() {
    const redirectUri = `${window.location.origin}/admin/auth/callback`
    const base = API_BASE || window.location.origin
    const dev = import.meta?.env?.VITE_AUTH_DISABLED === 'true'

    if (dev) {
      // Prefer cookie-less dev auth via /api/user (Worker returns mock user when AUTH_DISABLED=true)
      try {
        const respUser = await fetch(new URL('/api/user', base).toString(), {
          credentials: 'include',
          headers: { 'x-dev-auth': '1' },
        })
        if (respUser.ok) {
          const json = await respUser.json()
          this.user = json?.user || json
          if (this.user) {
            localStorage.setItem('user', JSON.stringify(this.user))
            const event = new CustomEvent('auth:change', { detail: { token: this.token, user: this.user } })
            window.dispatchEvent(event)
            // Navigate to app root after login
            window.location.assign('/admin')
            return
          }
        }
      } catch (e) {
        console.warn('Dev /api/user fetch failed, trying legacy dev login', e)
      }

      // Legacy: programmatic login endpoint (sets cookie). May fail if cookies blocked.
      try {
        const resp = await fetch(new URL('/api/auth/dev/login', base).toString(), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'x-dev-auth': '1' },
          body: JSON.stringify({}),
        })
        if (resp.ok) {
          const data = await resp.json()
          this.user = data.user
          localStorage.setItem('user', JSON.stringify(this.user))
          const event = new CustomEvent('auth:change', { detail: { token: this.token, user: this.user } })
          window.dispatchEvent(event)
          // Navigate to app root after login
          window.location.assign('/admin')
          return
        }
      } catch (e) {
        console.warn('Dev legacy login failed, falling back to OAuth redirect', e)
      }
    }

    // Fallback to GitHub OAuth
    const auth = new URL('/api/auth/github', base)
    auth.searchParams.set('redirect_uri', redirectUri)
    window.location.href = auth.toString()
  }

  async handleCallback(code, state) {
    try {
      // Complete OAuth on the Worker origin in dev
      const base = API_BASE || window.location.origin
      const url = new URL('/api/auth/callback', base)
      url.searchParams.set('code', code)
      if (state) {
        url.searchParams.set('state', state)
      }

      const response = await fetch(url.toString(), { credentials: 'include' })

      if (!response.ok) {
        throw new Error('Failed to authenticate')
      }

      const data = await response.json()

      if (data.error === 'access_denied') {
        throw new Error(
          data.error_description || 'Access denied: You are not authorized to use this service'
        )
      }

      this.user = data.user
      localStorage.setItem('user', JSON.stringify(this.user))
      const event = new CustomEvent('auth:change', {
        detail: { token: this.token, user: this.user },
      })
      window.dispatchEvent(event)

      return data
    } catch (error) {
      console.error('Authentication callback failed:', error)
      throw error
    }
  }

  logout() {
    this.token = null
    this.user = null
    localStorage.removeItem('user')
    const base = API_BASE || window.location.origin
    // Always clear local state and notify listeners synchronously, then
    // attempt the server logout. If the server call fails, log it and emit
    // a separate 'auth:logout-failed' event so callers can surface a toast.
    fetch(new URL('/api/auth/logout', base).toString(), {
      method: 'POST',
      credentials: 'include',
      headers: import.meta?.env?.VITE_AUTH_DISABLED === 'true' ? { 'x-dev-auth': '1' } : {},
    }).catch((err) => {
      console.error('Logout request failed', err)
      window.dispatchEvent(new CustomEvent('auth:logout-failed', { detail: { error: err?.message } }))
    })
    const event = new CustomEvent('auth:change', { detail: { token: null, user: null } })
    window.dispatchEvent(event)
  }

  getAuthHeaders() {
    return {}
  }
}

export const authService = new AuthService()
