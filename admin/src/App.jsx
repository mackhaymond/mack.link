import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react'
import { LinkList } from './components/LinkList'
import { LinkSearch } from './components/LinkSearch'
import { CreateLinkForm } from './components/CreateLinkForm'
import { Header } from './components/Header'
// Lazy-load Analytics to reduce initial mobile load
const Analytics = lazy(() => import('./components/Analytics').then(m => ({ default: m.Analytics })))
import { LoginScreen } from './components/LoginScreen'

import { authService } from './services/auth'
import { Plus, BarChart3, Link as LinkIcon } from 'lucide-react'
import { 
  ErrorBoundary,
  ErrorMessage,
  PageLoader,
  LinkListSkeleton,
  SearchSkeleton,
  BulkToolbarSkeleton,
  KeyboardShortcutsModal,
} from './components/ui'
import {
  useLinks,
  useCreateLink,
  useUpdateLink,
  useDeleteLink,
  useBulkDeleteLinks,
} from './hooks/useLinks'
import { useIsAnalyticsActive } from './hooks/useAnalytics'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

import { BottomNav } from './components/BottomNav'

function App() {
  const [filteredLinks, setFilteredLinks] = useState({})
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated())
  const [currentView, setCurrentView] = useState('links') // 'links' or 'analytics'
  const [documentVisible, setDocumentVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  )
  const searchInputRef = useRef(null)

  // M9: pause polling when the tab is hidden, resume on visibility change.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Check if analytics polling should be active
  const isAnalyticsActive = useIsAnalyticsActive(currentView)

  // Calculate mobile/save-data aware polling intervals
  const polling = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches
    const saveData = typeof navigator !== 'undefined' && navigator.connection && navigator.connection.saveData
    const baseActive = 15000
    const baseIdle = 10000
    const mobileActive = 25000
    const mobileIdle = 20000
    return {
      active: (isMobile || saveData) ? mobileActive : baseActive,
      idle: (isMobile || saveData) ? mobileIdle : baseIdle,
    }
  }, [])

  // React Query hooks - only run when authenticated
  // Make UI more realtime: interval tuned by current view and device settings
  const {
    data: links = {},
    isLoading,
    error,
    refetch,
  } = useLinks({
    enabled: isAuthenticated,
    refetchInterval: documentVisible ? (isAnalyticsActive ? polling.active : polling.idle) : false,
    refetchIntervalInBackground: false,
  })
  const createLinkMutation = useCreateLink()
  const updateLinkMutation = useUpdateLink()
  const deleteLinkMutation = useDeleteLink()
  const bulkDeleteMutation = useBulkDeleteLinks()

  // Listen for authentication state changes (no polling).
  // H9: also handle auth:unauthenticated (a 401/403 from the API surfaces here
  // instead of a hard page reload) and auth:logout-failed (toast for failed
  // server-side logout).
  useEffect(() => {
    const onAuthChange = () => setIsAuthenticated(authService.isAuthenticated())
    const onUnauthenticated = () => setIsAuthenticated(false)
    const onLogoutFailed = (e) => {
      console.warn('Logout failed on the server (local session cleared anyway):', e?.detail?.error)
    }
    window.addEventListener('auth:change', onAuthChange)
    window.addEventListener('auth:unauthenticated', onUnauthenticated)
    window.addEventListener('auth:logout-failed', onLogoutFailed)
    return () => {
      window.removeEventListener('auth:change', onAuthChange)
      window.removeEventListener('auth:unauthenticated', onUnauthenticated)
      window.removeEventListener('auth:logout-failed', onLogoutFailed)
    }
  }, [])

  const handleCreateLink = useCallback(
    async (linkData) => {
      await createLinkMutation.mutateAsync(linkData)
      setShowCreateForm(false)
    },
    [createLinkMutation]
  )

  const handleDeleteLink = useCallback(
    async (shortcode) => {
      await deleteLinkMutation.mutateAsync(shortcode)
    },
    [deleteLinkMutation]
  )

  const handleBulkDeleteLinks = useCallback(
    async (shortcodes) => {
      await bulkDeleteMutation.mutateAsync(shortcodes)
    },
    [bulkDeleteMutation]
  )

  const handleUpdateLink = useCallback(
    async (shortcode, updates) => {
      await updateLinkMutation.mutateAsync({ shortcode, updates })
    },
    [updateLinkMutation]
  )

  const handleRetryError = useCallback(() => {
    refetch()
  }, [refetch])

  // Warm up the Analytics chunk in the background after a brief idle
  useEffect(() => {
    const t = setTimeout(() => {
      // Fire-and-forget prefetch for faster tab switch
      import('./components/Analytics').catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [])



  const handleFilteredResults = useCallback((filtered) => {
    setFilteredLinks(filtered)
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'mod+n': () => setShowCreateForm(true),
    'mod+k': () => searchInputRef.current?.focus(),
    '/': () => searchInputRef.current?.focus(),
    // Focus app search instead of browser Find
    'mod+f': () => searchInputRef.current?.focus(),
    // Quick tab switching (note: browsers may reserve Cmd+1/2). Also support Alt+1/2 as fallback.
    'mod+1': () => setCurrentView('links'),
    'mod+2': () => setCurrentView('analytics'),
    'alt+1': () => setCurrentView('links'),
    'alt+2': () => setCurrentView('analytics'),
    // Open shortcuts help
    'mod+/': () => setShowKeyboardHelp(true),
    'shift+?': () => setShowKeyboardHelp(true),
    // Global escape closes overlays
    escape: () => {
      setShowCreateForm(false)
      setShowKeyboardHelp(false)
    },
  })

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen />
  }

  // Filter results are managed by LinkSearch via onFilteredResults

  if (isLoading) {
    return (
      <ErrorBoundary fallbackMessage="Something went wrong with the link management system.">
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 bg-blue-600 text-white px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Skip to main content
          </a>

          <Header />

          <main
            id="main-content"
            className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 content-pb-safe sm:pb-8"
            role="main"
          >
            <div className="sm:flex sm:items-center sm:justify-between mb-6 sm:mb-8">
              <header>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                  Link Management
                </h1>
                <p className="mt-1 sm:mt-2 text-sm text-gray-700 dark:text-gray-300">
                  Manage your short links and view analytics
                </p>
              </header>
              <div className="mt-3 sm:mt-4 sm:mt-0">
                <button
                  disabled
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-400 cursor-not-allowed"
                  aria-label="Create new short link (loading)"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  Create Link
                </button>
              </div>
            </div>

            <SearchSkeleton />
            <LinkListSkeleton count={6} />
          </main>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary fallbackMessage="Something went wrong with the link management system.">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
        {/* Skip Navigation */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 bg-blue-600 text-white px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Skip to main content
        </a>

        <Header onShowShortcuts={() => setShowKeyboardHelp(true)} />

        <main id="main-content" className="max-w-7xl mx-auto px-3 xs:px-4 sm:px-6 lg:px-8 pt-3 xs:pt-4 sm:pt-6 lg:pt-8 content-pb-safe sm:pb-8" role="main">
          <div className="sm:flex sm:items-center sm:justify-between mb-6 sm:mb-8">
            <header>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Link Management</h1>
              <p className="mt-1 sm:mt-2 text-sm text-gray-700 dark:text-gray-300">
                Manage your short links and view analytics
              </p>
            </header>
            <div className="mt-3 sm:mt-4 sm:mt-0">
              {!showCreateForm && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="hidden sm:inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 transition-colors"
                  aria-label="Create new short link"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  Create Link
                </button>
              )}
            </div>
          </div>

          {/* Navigation Tabs (desktop/tablet only) */}
          <div className="mb-4 sm:mb-6 hidden sm:block">
            <nav className="flex overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 space-x-4 sm:space-x-8 no-scrollbar ios-momentum" aria-label="Tabs">
              <button
                onClick={() => setCurrentView('links')}
                className={`${
                  currentView === 'links'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center transition-colors`}
              >
                <LinkIcon className="w-4 h-4 mr-2" />
                Links
              </button>
              <button
                onClick={() => setCurrentView('analytics')}
                className={`${
                  currentView === 'analytics'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center transition-colors`}
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Analytics
              </button>
            </nav>
          </div>

          <ErrorMessage error={error} onRetry={handleRetryError} className="mb-4" />

          {/* Content based on current view */}
          {currentView === 'links' ? (
            <>
              <LinkSearch
                links={links}
                onFilteredResults={handleFilteredResults}
                searchInputRef={searchInputRef}
              />

              <LinkList
                links={filteredLinks}
                onDelete={handleDeleteLink}
                onUpdate={handleUpdateLink}
                onBulkDelete={handleBulkDeleteLinks}
              />
            </>
          ) : (
            <Suspense fallback={<PageLoader />}>
              <Analytics links={links} currentView={currentView} />
            </Suspense>
          )}

          {showCreateForm && (
            <CreateLinkForm onSubmit={handleCreateLink} onClose={() => setShowCreateForm(false)} />
          )}

          {/* Mobile Floating Create Button */}
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="sm:hidden fixed fab-offset right-4 sm:right-5 z-50 rounded-full p-3 sm:p-4 shadow-lg bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 active:scale-95 transition-all"
              aria-label="Create new short link"
            >
              <Plus className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          )}

          {/* Mobile Bottom Navigation */}
          <BottomNav
            currentView={currentView}
            setCurrentView={setCurrentView}
          />
        </main>
        <KeyboardShortcutsModal isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
      </div>
    </ErrorBoundary>
  )
}

export default App
