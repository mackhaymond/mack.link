import { useMemo, useState, useEffect } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  useAnalyticsOverview,
  useAnalyticsTimeseries,
  useAnalyticsTimeseriesLinks,
  useAnalyticsBreakdown,
  useIsAnalyticsActive,
} from '../hooks/useAnalytics'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)
import { BarChart3, TrendingUp, Clock, Globe, Download } from 'lucide-react'
import { StatCard } from './StatCard'

export function Analytics({ links, currentView }) {
  const [range, setRange] = useState({
    from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  })
  const [dimension, setDimension] = useState('ref')
  const [scope, setScope] = useState('all') // 'all' | 'shortcode'
  const [shortcode, setShortcode] = useState(Object.keys(links)[0])
  const [isExporting, setIsExporting] = useState(false)

  // Keep selected shortcode in sync with incoming links
  useEffect(() => {
    if (scope !== 'shortcode') return
    const keys = Object.keys(links)
    if (keys.length === 0) return
    if (!keys.includes(shortcode)) {
      setShortcode(keys[0])
    }
  }, [links, scope, shortcode])

  // Check if analytics polling should be active
  const isAnalyticsActive = useIsAnalyticsActive(currentView)

  // Fetch analytics data with React Query hooks (with polling when analytics tab is active)
  const { data: overview } = useAnalyticsOverview(
    { scope, shortcode, range },
    { enabled: isAnalyticsActive }
  )

  const { data: ts } = useAnalyticsTimeseries(
    { scope, shortcode, range },
    { enabled: isAnalyticsActive }
  )

  // Multi-series for top links (global scope only)
  const { data: tsLinks } = useAnalyticsTimeseriesLinks(
    { range, limit: 5 },
    { enabled: isAnalyticsActive && scope === 'all' }
  )

  const { data: refTop } = useAnalyticsBreakdown(
    { scope, shortcode, range, dimension },
    { enabled: isAnalyticsActive }
  )
  const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches

  const analytics = useMemo(() => {
    const linkEntries = Object.entries(links)

    if (linkEntries.length === 0) {
      return {
        totalLinks: 0,
        totalClicks: 0,
        averageClicks: 0,
        topLinks: [],
        recentLinks: [],
        clicksToday: 0,
      }
    }

    const totalLinks = linkEntries.length
    // Use overview API data for click totals instead of calculating from links to ensure consistency
    const totalClicks = overview?.totalClicks || 0
    const averageClicks = totalLinks > 0 ? Math.round((totalClicks / totalLinks) * 100) / 100 : 0

    // Get top 5 most clicked links (used in global scope only)
    const topLinks = linkEntries
      .sort(([, a], [, b]) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, 5)
      .map(([shortcode, link]) => ({
        shortcode,
        url: link.url,
        clicks: link.clicks || 0,
        description: link.description,
      }))

    // Get 5 most recent links (used in global scope only)
    const recentLinks = linkEntries
      .sort(([, a], [, b]) => new Date(b.created) - new Date(a.created))
      .slice(0, 5)
      .map(([shortcode, link]) => ({
        shortcode,
        url: link.url,
        clicks: link.clicks || 0,
        created: link.created,
        description: link.description,
      }))

    // clicksToday now comes from backend overview for both scopes
    const clicksToday = overview?.clicksToday || 0

    return {
      totalLinks,
      totalClicks,
      averageClicks,
      topLinks,
      recentLinks,
      clicksToday,
    }
  }, [links, overview])

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }


  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 sm:p-5">
        <div className="grid gap-4 md:gap-5 grid-cols-1 lg:grid-cols-[1fr_auto] items-start">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4">
            {/* Scope segmented control */}
            <div className="flex flex-col xs:flex-row xs:items-center gap-2 w-full sm:w-auto">
              <div
                className="flex rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden w-full xs:w-auto"
                role="group"
                aria-label="Scope"
              >
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
                    scope === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setScope('shortcode')}
                  className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                    scope === 'shortcode'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  Single
                </button>
              </div>

              {/* Shortcode picker */}
              {scope === 'shortcode' && (
                <div className="flex items-center gap-2 w-full xs:w-auto">
                  <label className="text-xs xs:text-sm text-gray-600 dark:text-gray-300 shrink-0">Shortcode</label>
                  <select
                    value={shortcode || ''}
                    onChange={(e) => setShortcode(e.target.value)}
                    className="flex-1 xs:w-36 sm:w-40 px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.keys(links).map((sc) => (
                      <option key={sc} value={sc}>
                        {sc}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Date range with presets */}
            <div className="flex flex-col xs:flex-row xs:items-center gap-2 w-full sm:w-auto">
              <label className="hidden md:inline text-sm text-gray-600 dark:text-gray-300 shrink-0">Date</label>
              <div className="grid grid-cols-1 xs:grid-cols-2 gap-2 w-full xs:w-auto">
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="w-full xs:w-36 sm:w-40 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="w-full xs:w-36 sm:w-40 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div
                className="flex xs:inline-flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-full xs:w-auto"
                role="group"
                aria-label="Quick ranges"
              >
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date()
                    const s = d.toISOString().slice(0, 10)
                    setRange({ from: s, to: s })
                  }}
                  className="flex-1 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const to = new Date()
                    const from = new Date(Date.now() - 7 * 86400000)
                    setRange({
                      from: from.toISOString().slice(0, 10),
                      to: to.toISOString().slice(0, 10),
                    })
                  }}
                  className="flex-1 px-3 py-1.5 text-xs border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  7d
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const to = new Date()
                    const from = new Date(Date.now() - 30 * 86400000)
                    setRange({
                      from: from.toISOString().slice(0, 10),
                      to: to.toISOString().slice(0, 10),
                    })
                  }}
                  className="flex-1 px-3 py-1.5 text-xs border-l border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  30d
                </button>
              </div>
            </div>

            {/* Breakdown select */}
            <div className="flex flex-col xs:flex-row xs:items-center gap-2 w-full sm:w-auto">
              <label className="hidden md:inline text-sm text-gray-600 dark:text-gray-300 shrink-0">Breakdown</label>
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                className="w-full xs:w-[14rem] px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ref">Referrer</option>
                <option value="country">Country</option>
                <option value="device">Device</option>
                <option value="browser">Browser</option>
                <option value="os">Operating System</option>
                <option value="city">City</option>
                <option value="utm_source">UTM Source</option>
                <option value="utm_medium">UTM Medium</option>
                <option value="utm_campaign">UTM Campaign</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3 justify-start lg:justify-end shrink-0">
            {/* Export Button */}
            <button
              onClick={async () => {
                if (isExporting) return

                setIsExporting(true)
                try {
                  const params = new URLSearchParams()
                  if (scope === 'shortcode' && shortcode) {
                    params.set('shortcode', shortcode)
                  }
                  params.set('from', range.from)
                  params.set('to', range.to)
                  params.set('format', 'json')

                  const headers = {}
                  if (import.meta?.env?.VITE_AUTH_DISABLED === 'true') {
                    headers['x-dev-auth'] = '1'
                  }
                  const response = await fetch(`/api/analytics/export?${params.toString()}`, {
                    credentials: 'include',
                    headers,
                  })

                  if (!response.ok) throw new Error('Export failed')

                  const blob = await response.blob()
                  const url = window.URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.style.display = 'none'
                  a.href = url
                  a.download = `analytics-${scope === 'shortcode' ? shortcode : 'global'}-${range.from}-${range.to}.json`
                  document.body.appendChild(a)
                  a.click()
                  window.URL.revokeObjectURL(url)
                  document.body.removeChild(a)
                } catch (error) {
                  console.error('Export failed:', error)
                  alert('Failed to export analytics data')
                } finally {
                  setIsExporting(false)
                }
              }}
              disabled={isExporting}
              className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors w-full xs:w-auto"
            >
              <Download className="w-4 h-4 mr-1" />
              {isExporting ? 'Exporting...' : 'Export'}
            </button>

            {/* Summary badges */}
            <div className="hidden sm:inline-flex items-center gap-3 text-sm">
              {overview && (
                <>
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Total{' '}
                    <span className="ml-1 font-semibold">{overview.totalClicks.toLocaleString()}</span>
                  </span>
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800">
                    Today{' '}
                    <span className="ml-1 font-semibold">{overview.clicksToday.toLocaleString()}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {overview && (
          <div className="sm:hidden mt-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <BarChart3 className="w-3.5 h-3.5" />
                <span className="font-semibold">{overview.totalClicks.toLocaleString()}</span>
                clicks
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-semibold">{overview.clicksToday.toLocaleString()}</span>
                today
              </span>
            </div>
          </div>
        )}
      </div>
      {/* Stats Overview: scope-aware */}
      {scope === 'all' ? (
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Globe}
            title="Total Links"
            value={analytics.totalLinks}
            color="text-blue-600 dark:text-blue-400"
          />
          <StatCard
            icon={BarChart3}
            title="Total Clicks"
            value={(overview?.totalClicks || 0).toLocaleString()}
            color="text-green-600 dark:text-green-400"
          />
          <StatCard
            icon={TrendingUp}
            title="Average Clicks"
            value={analytics.averageClicks}
            subtitle="per link"
            color="text-purple-600 dark:text-purple-400"
          />
          <StatCard
            icon={Clock}
            title="Clicks Today"
            value={overview?.clicksToday || 0}
            color="text-orange-600 dark:text-orange-400"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={BarChart3}
            title="Link Clicks"
            value={(overview?.totalClicks || 0).toLocaleString()}
            color="text-green-600 dark:text-green-400"
          />
          <StatCard
            icon={Clock}
            title="Clicks Today"
            value={overview?.clicksToday || 0}
            color="text-orange-600 dark:text-orange-400"
          />
          <StatCard
            icon={TrendingUp}
            title="Redirect Type"
            value={links[shortcode]?.redirectType || 301}
            color="text-purple-600 dark:text-purple-400"
          />
          <StatCard
            icon={Globe}
            title="Last Clicked"
            value={links[shortcode]?.lastClicked ? formatDate(links[shortcode].lastClicked) : '—'}
          />
        </div>
      )}

      {/* Top Performing and Recent: global scope only */}
      {scope === 'all' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Performing Links */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 transition-colors">
            {isMobile ? (
              <details open>
                <summary className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 text-lg font-semibold text-gray-900 dark:text-white flex items-center cursor-pointer select-none">
                  <TrendingUp className="w-5 h-5 mr-2 text-green-600 dark:text-green-400" />
                  Top Performing Links
                </summary>
                <div className="p-6">
                  {analytics.topLinks.length > 0 ? (
                    <div className="space-y-4">
                      {analytics.topLinks.map((link, index) => (
                        <div key={link.shortcode} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white rounded-full ${
                                  index === 0
                                    ? 'bg-yellow-500'
                                    : index === 1
                                      ? 'bg-gray-400'
                                      : index === 2
                                        ? 'bg-yellow-600'
                                        : 'bg-gray-300'
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {link.shortcode}
                                </p>
                                {link.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {link.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="ml-4 flex-shrink-0">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400">
                              {link.clicks.toLocaleString()} clicks
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                      No links with clicks yet
                    </p>
                  )}
                </div>
              </details>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <TrendingUp className="w-5 h-5 mr-2 text-green-600 dark:text-green-400" />
                    Top Performing Links
                  </h3>
                </div>
                <div className="p-6">
                  {analytics.topLinks.length > 0 ? (
                    <div className="space-y-4">
                      {analytics.topLinks.map((link, index) => (
                        <div key={link.shortcode} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white rounded-full ${
                                  index === 0
                                    ? 'bg-yellow-500'
                                    : index === 1
                                      ? 'bg-gray-400'
                                      : index === 2
                                        ? 'bg-yellow-600'
                                        : 'bg-gray-300'
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                  {link.shortcode}
                                </p>
                                {link.description && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {link.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="ml-4 flex-shrink-0">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400">
                              {link.clicks.toLocaleString()} clicks
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                      No links with clicks yet
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Recently Created */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 transition-colors">
            {isMobile ? (
              <details open>
                <summary className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 text-lg font-semibold text-gray-900 dark:text-white flex items-center cursor-pointer select-none">
                  <Clock className="w-5 h-5 mr-2 text-orange-600" />
                  Recently Created
                </summary>
                <div className="p-6">
                  {analytics.recentLinks.length > 0 ? (
                    <div className="space-y-4">
                      {analytics.recentLinks.map((link) => (
                        <div key={link.shortcode} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {link.shortcode}
                            </p>
                            {link.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {link.description}
                              </p>
                            )}
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {formatDate(link.created)}
                            </p>
                          </div>
                          <div className="ml-4 flex-shrink-0">
                            <span className="text-sm text-gray-600 dark:text-gray-300">
                              {link.clicks.toLocaleString()} clicks
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                      No links created yet
                    </p>
                  )}
                </div>
              </details>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <Clock className="w-5 h-5 mr-2 text-orange-600" />
                    Recently Created
                  </h3>
                </div>
                <div className="p-6">
                  {analytics.recentLinks.length > 0 ? (
                    <div className="space-y-4">
                      {analytics.recentLinks.map((link) => (
                        <div key={link.shortcode} className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {link.shortcode}
                            </p>
                            {link.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {link.description}
                              </p>
                            )}
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                              {formatDate(link.created)}
                            </p>
                          </div>
                          <div className="ml-4 flex-shrink-0">
                            <span className="text-sm text-gray-600 dark:text-gray-300">
                              {link.clicks.toLocaleString()} clicks
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                      No links created yet
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Timeseries and breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 transition-colors">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white flex items-center">
                <BarChart3 className="w-5 h-5 mr-2 text-blue-600" />
                Clicks Over Time
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Times shown in UTC.</p>
            </div>
          </div>
          <div className="p-6">
            {(scope === 'all' && tsLinks?.labels?.length && tsLinks?.series?.length) ? (
              <Line
                key={`tslinks-${tsLinks.labels?.length || 0}-${tsLinks.series?.length || 0}`}
                style={{ width: '100%' }}
                data={{
                  labels: tsLinks.labels,
                  datasets: tsLinks.series.map((s, idx) => {
                    const baseColors = [
                      [37,99,235],   // blue-600
                      [16,185,129],  // emerald-500
                      [234,179,8],   // yellow-500
                      [249,115,22],  // orange-500
                      [236,72,153],  // pink-500
                      [168,85,247],  // purple-500
                      [59,130,246],  // blue-500
                    ]
                    const [r,g,b] = baseColors[idx % baseColors.length]
                    return {
                      label: s.shortcode,
                      data: s.values,
                      borderColor: `rgb(${r}, ${g}, ${b})`,
                      backgroundColor: `rgba(${r}, ${g}, ${b}, 0.22)`,
                      borderWidth: 2,
                      tension: 0.25,
                      fill: true,
                      pointRadius: 0,
                      pointHitRadius: 6,
                      pointHoverRadius: 3,
                    }
                  }),
                }}
                options={{
                  responsive: true,
                  resizeDelay: 0,
                  plugins: { legend: { display: !isMobile, position: 'bottom' } },
                  interaction: { mode: 'index', intersect: false },
                  maintainAspectRatio: false,
                  layout: { padding: { top: 8, right: 12, bottom: 28, left: 8 } },
                  scales: {
                    x: {
                      grid: { display: false },
                      ticks: { autoSkip: true, maxTicksLimit: isMobile ? 5 : 8, maxRotation: 0, font: { size: isMobile ? 10 : 12 } },
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: 'rgba(148,163,184,0.2)' },
                      ticks: { font: { size: isMobile ? 10 : 12 } },
                    },
                  },
                }}
                height={isMobile ? 160 : 180}
              />
            ) : ts?.points?.length ? (
              <Line
                key={`tssingle-${ts.points?.length || 0}`}
                style={{ width: '100%' }}
                data={{
                  labels: ts.points.map((p) => p.date),
                  datasets: [
                    {
                      label: 'Clicks',
                      data: ts.points.map((p) => p.clicks),
                      borderColor: '#2563eb',
                      backgroundColor: 'rgba(37,99,235,0.25)',
                      tension: 0.25,
                      fill: true,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  resizeDelay: 0,
                  plugins: { legend: { display: false } },
                  maintainAspectRatio: false,
                  layout: { padding: { top: 8, right: 12, bottom: 12, left: 8 } },
                  scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: isMobile ? 6 : 12, font: { size: isMobile ? 10 : 12 } } },
                    y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.2)' }, ticks: { font: { size: isMobile ? 10 : 12 } } },
                  },
                }}
              />
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                No data for selected range
              </p>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 transition-colors">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Top{' '}
              {dimension === 'ref'
                ? 'Referrers'
                : dimension === 'country'
                  ? 'Countries'
                  : dimension === 'device'
                    ? 'Devices'
                    : dimension === 'browser'
                      ? 'Browsers'
                      : dimension === 'os'
                        ? 'Operating Systems'
                        : dimension === 'city'
                          ? 'Cities'
                          : dimension === 'utm_source'
                            ? 'UTM Sources'
                            : dimension === 'utm_medium'
                              ? 'UTM Mediums'
                              : dimension === 'utm_campaign'
                                ? 'UTM Campaigns'
                                : 'Items'}
            </h3>
          </div>
          <div className="p-6">
            {refTop?.items?.length ? (
              <Bar
                data={{
                  labels: refTop.items.map((i) => i.key || 'direct'),
                  datasets: [
                    {
                      label: 'Clicks',
                      data: refTop.items.map((i) => i.clicks),
                      backgroundColor: 'rgba(37,99,235,0.6)',
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { size: isMobile ? 10 : 12 } } },
                    y: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12 } } },
                  },
                }}
              />
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                No data for selected range
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
