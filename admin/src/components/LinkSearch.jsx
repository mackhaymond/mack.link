import { useState, useCallback, useMemo, useEffect } from 'react'
import { Search, Filter, X, Calendar, BarChart3 } from 'lucide-react'
import { Input, Button } from './ui'
import { MobileFiltersSheet } from './MobileFiltersSheet'

export function LinkSearch({ links, onFilteredResults, searchInputRef }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortBy, setSortBy] = useState('created')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showFilters, setShowFilters] = useState(false)
  const [dateFilter, setDateFilter] = useState('')
  const [clicksFilter, setClicksFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const filteredAndSortedLinks = useMemo(() => {
    let filtered = Object.entries(links)

    // Text search
    if (debouncedQuery.trim()) {
      const query = debouncedQuery.toLowerCase()
      filtered = filtered.filter(([shortcode, link]) => 
        shortcode.toLowerCase().includes(query) ||
        link.url.toLowerCase().includes(query) ||
        (link.description && link.description.toLowerCase().includes(query))
      )
    }

    // Date filter
    if (dateFilter) {
      const filterDate = new Date(dateFilter)
      const filterTime = filterDate.getTime()
      filtered = filtered.filter(([, link]) => {
        const linkDate = new Date(link.created)
        return linkDate.getTime() >= filterTime
      })
    }

    // Clicks filter
    if (clicksFilter) {
      const minClicks = parseInt(clicksFilter)
      if (!isNaN(minClicks)) {
        filtered = filtered.filter(([, link]) => (link.clicks || 0) >= minClicks)
      }
    }

    // Tag filter
    if (tagFilter.trim()) {
      const tag = tagFilter.toLowerCase()
      filtered = filtered.filter(([, link]) => Array.isArray(link.tags) && link.tags.some(t => t.toLowerCase().includes(tag)))
    }

    // Archive filter
    if (!showArchived) {
      filtered = filtered.filter(([, link]) => !link.archived)
    }

    // Sort
    filtered.sort(([shortcodeA, linkA], [shortcodeB, linkB]) => {
      let valueA, valueB
      
      switch (sortBy) {
        case 'shortcode':
          valueA = shortcodeA
          valueB = shortcodeB
          break
        case 'url':
          valueA = linkA.url
          valueB = linkB.url
          break
        case 'clicks':
          valueA = linkA.clicks || 0
          valueB = linkB.clicks || 0
          break
        case 'created':
          valueA = new Date(linkA.created)
          valueB = new Date(linkB.created)
          break
        case 'updated':
          valueA = new Date(linkA.updated)
          valueB = new Date(linkB.updated)
          break
        default:
          valueA = linkA.created
          valueB = linkB.created
      }

      if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase()
        valueB = valueB.toLowerCase()
      }

      if (valueA < valueB) return sortOrder === 'asc' ? -1 : 1
      if (valueA > valueB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return Object.fromEntries(filtered)
  }, [links, debouncedQuery, sortBy, sortOrder, dateFilter, clicksFilter, tagFilter, showArchived])

  const handleSearchChange = useCallback((e) => {
    setSearchQuery(e.target.value)
  }, [])

  // Debounce the free-text query for smoother UX
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 250)
    return () => clearTimeout(id)
  }, [searchQuery])

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setDateFilter('')
    setClicksFilter('')
    setTagFilter('')
    setShowArchived(false)
    setSortBy('created')
    setSortOrder('desc')
  }, [])

  const hasFilters = searchQuery || dateFilter || clicksFilter || tagFilter || showArchived || sortBy !== 'created' || sortOrder !== 'desc'
  const resultCount = Object.keys(filteredAndSortedLinks).length
  const totalCount = Object.keys(links).length

  // Call the parent callback with filtered results
  useEffect(() => {
    onFilteredResults(filteredAndSortedLinks)
  }, [filteredAndSortedLinks, onFilteredResults])

  return (
    <div className="bg-white/95 dark:bg-gray-800/95 supports-[backdrop-filter]:backdrop-blur rounded-lg shadow dark:shadow-gray-700/50 mb-4 sm:mb-6 transition-colors sticky top-0 sm:static z-20">
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search links..."
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    e.preventDefault()
                    setSearchQuery('')
                  } else {
                    // Blur when empty, letting global Escape handlers proceed
                    e.currentTarget.blur()
                  }
                }
              }}
              className="mobile-input w-full pl-10 pr-4 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-base sm:text-sm"
              aria-label="Search links"
              role="searchbox"
            />
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (window.matchMedia('(max-width: 640px)').matches ? setMobileFiltersOpen(true) : setShowFilters(!showFilters))}
              className="flex items-center min-h-[44px] px-3 sm:px-4"
            >
              <Filter className="w-4 h-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Filters</span>
              <span className="sm:hidden">Filter</span>
              {hasFilters && (
                <span className="ml-1 sm:ml-2 bg-blue-600 text-white text-xs rounded-full px-1.5 sm:px-2 py-0.5">
                  {[searchQuery, dateFilter, clicksFilter, tagFilter, showArchived ? 'archived' : ''].filter(Boolean).length}
                </span>
              )}
            </Button>
            
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="flex items-center text-red-600 hover:text-red-700 min-h-[44px] px-2 sm:px-3"
              >
                <X className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Clear</span>
              </Button>
            )}
          </div>
        </div>

        {/* Desktop/tablet filter grid */}
        {showFilters && (
          <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sort by
                </label>
                <select
                  value={`${sortBy}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split('-')
                    setSortBy(field)
                    setSortOrder(order)
                  }}
                  className="w-full px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="created-desc">Newest first</option>
                  <option value="created-asc">Oldest first</option>
                  <option value="clicks-desc">Most clicks</option>
                  <option value="clicks-asc">Least clicks</option>
                  <option value="shortcode-asc">Shortcode A-Z</option>
                  <option value="shortcode-desc">Shortcode Z-A</option>
                  <option value="updated-desc">Recently updated</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Created after
                </label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="mobile-input date-picker w-full px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Min. clicks
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={clicksFilter}
                  onChange={(e) => setClicksFilter(e.target.value)}
                  className="mobile-input w-full px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Tag contains
                </label>
                <input
                  type="text"
                  placeholder="work"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="mobile-input w-full px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                />
              </div>

              <div className="flex items-end">
                <label className="inline-flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300 min-h-[44px]">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                  <span>Show archived</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {(searchQuery || hasFilters) && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-between text-sm flex-wrap gap-3">
            <span className="text-gray-600 dark:text-gray-300">
              Showing {resultCount} of {totalCount} links
              {searchQuery && (
                <span className="ml-2">
                  for "<span className="font-medium">{searchQuery}</span>"
                </span>
              )}
            </span>
            
            {resultCount === 0 && totalCount > 0 && (
              <span className="text-gray-500 dark:text-gray-400">
                Try adjusting your search or filters
              </span>
            )}
          </div>

          {/* Active filter chips */}
          {hasFilters && (
            <div className="mt-2 flex flex-wrap gap-2">
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs">query: {searchQuery} ×</button>
              )}
              {dateFilter && (
                <button onClick={() => setDateFilter('')} className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 text-xs">created ≥ {dateFilter} ×</button>
              )}
              {clicksFilter && (
                <button onClick={() => setClicksFilter('')} className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 text-xs">≥ {clicksFilter} clicks ×</button>
              )}
              {tagFilter && (
                <button onClick={() => setTagFilter('')} className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs">tag: {tagFilter} ×</button>
              )}
              {showArchived && (
                <button onClick={() => setShowArchived(false)} className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-xs">show archived ×</button>
              )}
              {(sortBy !== 'created' || sortOrder !== 'desc') && (
                <button onClick={() => { setSortBy('created'); setSortOrder('desc') }} className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 text-xs">sort reset ×</button>
              )}
            </div>
          )}
        </div>
      )}
      {/* Mobile Filters Sheet */}
      <div className="sm:hidden">
        <MobileFiltersSheet
          isOpen={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          onClear={() => {
            setSearchQuery('')
            setDateFilter('')
            setClicksFilter('')
            setTagFilter('')
            setShowArchived(false)
            setSortBy('created')
            setSortOrder('desc')
          }}
          onApply={(next) => {
            setSortBy(next.sortBy)
            setSortOrder(next.sortOrder)
            setDateFilter(next.dateFilter || '')
            setClicksFilter(next.clicksFilter || '')
            setTagFilter(next.tagFilter || '')
            setShowArchived(!!next.showArchived)
            setMobileFiltersOpen(false)
          }}
          values={{ sortBy, sortOrder, dateFilter, clicksFilter, tagFilter, showArchived }}
        />
      </div>
    </div>
  )
}
