import { Link as LinkIcon, LogOut, Moon, Sun, Keyboard, Shield } from 'lucide-react'
import { authService } from '../services/auth'
import { useTheme } from '../providers/ThemeProvider'

export function Header({ user, onShowShortcuts = () => {} }) {
  const { theme, toggleTheme } = useTheme()
  const authDisabled = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AUTH_DISABLED === 'true'

  // Sprint 2a (A3): authService.logout() navigates to Cloudflare's
  // /cdn-cgi/access/logout in prod (or reloads the page in dev:ai mode
  // where Access isn't running). No need to reload-after-logout here -
  // navigation away handles the state reset.
  const handleLogout = () => {
    authService.logout()
  }

  // Build a stable initials avatar fallback. Real Cloudflare Access identities
  // don't include an avatar_url, so we render the user's first letter on
  // a colored background when no image is set.
  const initial = (user?.name || user?.login || user?.email || '?').charAt(0).toUpperCase()
  const hasAvatar = Boolean(user?.avatar_url)

  return (
    <header className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 transition-colors" role="banner">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 sm:gap-4 py-3 sm:py-6">
          <div className="flex items-center min-w-0 flex-1">
            <LinkIcon className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 dark:text-blue-400 mr-2 sm:mr-3 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white truncate">link.mackhaymond.co</h1>
              <p className="hidden sm:block text-sm text-gray-600 dark:text-gray-300">URL Shortener Management</p>
            </div>
          </div>

          <div className="flex items-center space-x-1 sm:space-x-4 flex-shrink-0">
            <button
              onClick={onShowShortcuts}
              className="hidden sm:inline-flex p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors"
              aria-label="Show keyboard shortcuts (Ctrl/Cmd + /)"
              title="Keyboard shortcuts (Ctrl/Cmd + /)"
            >
              <Keyboard className="w-5 h-5" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 sm:p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-colors"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
            {authDisabled && (
              <div className="flex items-center text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" title="Local dev: AUTH_DISABLED=true on the Worker; Cloudflare Access is not running.">
                <Shield className="w-4 h-4 mr-1" /> Dev auth bypass
              </div>
            )}
            {user && (
              <nav className="flex items-center space-x-2 sm:space-x-4" role="navigation" aria-label="User menu">
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300" role="status" aria-live="polite">
                  {hasAvatar ? (
                    <img
                      src={user.avatar_url}
                      alt={`${user.login}'s profile picture`}
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0 bg-blue-600 text-white text-xs font-semibold flex items-center justify-center"
                    >
                      {initial}
                    </span>
                  )}
                  <span className="hidden sm:block truncate max-w-[8rem] lg:max-w-none">Welcome, {user.login}!</span>
                  <span className="sm:hidden text-xs truncate max-w-[4rem]">{user.login}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-1 px-2 py-1 sm:px-3 sm:py-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 rounded"
                  aria-label={`Sign out of ${user.login}'s account`}
                >
                  <LogOut className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
