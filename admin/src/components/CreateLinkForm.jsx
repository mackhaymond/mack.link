import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'
import { Button, Input } from './ui'
import { useReservedPaths, isShortcodeReserved, getReservedShortcodeError } from '../hooks/useReservedPaths'
import { useModalA11y } from '../hooks/useModalA11y'

export function CreateLinkForm({ onSubmit, onClose }) {
  const [formData, setFormData] = useState({
    shortcode: '',
    url: '',
    description: '',
    redirectType: 301,
    tags: [],
    activatesAt: '',
    expiresAt: '',
    password: '',
    passwordProtectionEnabled: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const shortcodeRef = useRef(null)
  const { reservedPaths, loading: reservedPathsLoading } = useReservedPaths()

  // H11: dirty if anything has been entered or toggled away from defaults.
  const isDirty = useMemo(() => {
    return Boolean(
      formData.shortcode || formData.url || formData.description ||
      formData.tags.length > 0 || formData.activatesAt || formData.expiresAt ||
      formData.password || formData.passwordProtectionEnabled,
    )
  }, [formData])

  const { containerRef, requestClose } = useModalA11y({ onClose, isDirty })

  useEffect(() => {
    shortcodeRef.current?.focus()
  }, [])

  const validateField = useCallback((name, value) => {
    switch (name) {
      case 'shortcode':
        if (!value.trim()) return 'Shortcode is required'
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
          return 'Shortcode can only contain letters, numbers, hyphens, and underscores'
        }
        if (value.length < 2) return 'Shortcode must be at least 2 characters'
        if (value.length > 50) return 'Shortcode must be less than 50 characters'
        
        // Check against reserved paths
        if (isShortcodeReserved(value, reservedPaths)) {
          return getReservedShortcodeError(value)
        }
        
        return null
      case 'url':
        if (!value.trim()) return 'URL is required'
        if (!/^https?:\/\/.+/.test(value)) {
          return 'URL must start with http:// or https://'
        }
        try {
          new URL(value)
        } catch {
          return 'Please enter a valid URL'
        }
        return null
      case 'description':
        if (value.length > 200) return 'Description must be less than 200 characters'
        return null
      case 'password':
        if (value && value.length < 8) return 'Password must be at least 8 characters'
        if (value && value.length > 128) return 'Password must be less than 128 characters'
        return null
      default:
        return null
    }
  }, [reservedPaths])

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault()
      setError(null)
      setFieldErrors({})

      const errors = {}
      Object.keys(formData).forEach((key) => {
        const error = validateField(key, formData[key])
        if (error) errors[key] = error
      })

      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors)
        return
      }

      try {
        setLoading(true)
        // Normalize datetime-local to ISO 8601 (UTC)
        const toISO = (s) =>
          s && typeof s === 'string' && s.trim() !== '' ? new Date(s).toISOString() : undefined
        const payload = {
          shortcode: formData.shortcode,
          url: formData.url,
          description: formData.description,
          redirectType: formData.redirectType,
          tags: Array.isArray(formData.tags) ? formData.tags : [],
          activatesAt: toISO(formData.activatesAt),
          expiresAt: toISO(formData.expiresAt),
          password: formData.passwordProtectionEnabled
            ? formData.password.trim() || undefined
            : undefined,
        }
        await onSubmit(payload)
      } catch (error) {
        setError(error.message)
      } finally {
        setLoading(false)
      }
    },
    [formData, onSubmit, validateField]
  )

  const handleChange = useCallback(
    (e) => {
      const { name, value } = e.target
      const newValue = name === 'redirectType' ? parseInt(value) : value

      setFormData((prev) => ({
        ...prev,
        [name]: newValue,
      }))

      // Clear field error when user starts typing
      if (fieldErrors[name]) {
        setFieldErrors((prev) => ({
          ...prev,
          [name]: null,
        }))
      }

      // Real-time validation
      const error = validateField(name, newValue)
      if (error && newValue) {
        setFieldErrors((prev) => ({
          ...prev,
          [name]: error,
        }))
      }
    },
    [fieldErrors, validateField]
  )

  return (
    <div
      className="fixed inset-0 bg-black/20 dark:bg-black/30 backdrop-blur-sm backdrop-saturate-150 z-50 transition duration-200 ease-out flex items-start sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-link-title"
    >
      <div
        ref={containerRef}
        className="mx-auto w-screen sm:w-full h-[100svh] sm:h-auto max-w-none sm:max-w-2xl border border-gray-200 dark:border-gray-700 shadow-lg rounded-none sm:rounded-md bg-white dark:bg-gray-800 transition-colors p-4 sm:p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sm:mb-6 sticky top-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 border-b border-gray-200 dark:border-gray-700 sm:border-0">
          <h3 id="create-link-title" className="text-lg sm:text-xl font-medium text-gray-900 dark:text-white">Create New Link</h3>
          <button 
            onClick={requestClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close create link form"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="md:col-span-2">
            <label
              htmlFor="shortcode"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Short Code *
            </label>
            <div className="flex items-stretch">
              <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs sm:text-sm">
                  link.mackhaymond.co/
                </span>
                <input
                  ref={shortcodeRef}
                  type="text"
                  name="shortcode"
                  id="shortcode"
                  value={formData.shortcode}
                  onChange={handleChange}
                  className="flex-1 min-w-0 pr-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-r-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors text-base sm:text-sm"
                  placeholder="abc123"
                  required
                  inputMode="latin"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
              />
            </div>
            {fieldErrors.shortcode && (
              <p className="mt-2 text-sm text-red-600">{fieldErrors.shortcode}</p>
            )}
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Destination URL *
            </label>
              <input
                type="url"
                name="url"
                id="url"
                value={formData.url}
                onChange={handleChange}
                className="block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors text-base sm:text-sm"
                placeholder="https://example.com"
                required
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
              />
            {fieldErrors.url && <p className="mt-2 text-sm text-red-600">{fieldErrors.url}</p>}
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Description
            </label>
            <input
              type="text"
              name="description"
              id="description"
              value={formData.description}
              onChange={handleChange}
              className="block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors text-base sm:text-sm"
              placeholder="Optional description"
            />
            {fieldErrors.description && (
              <p className="mt-2 text-sm text-red-600">{fieldErrors.description}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="redirectType"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Redirect Type
            </label>
            <select
              name="redirectType"
              id="redirectType"
              value={formData.redirectType}
              onChange={handleChange}
              className="block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
            >
              <option value={301}>301 - Permanent</option>
              <option value={302}>302 - Temporary</option>
              <option value={307}>307 - Temporary (preserve method)</option>
              <option value={308}>308 - Permanent (preserve method)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="tags"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Tags (comma separated)
            </label>
            <input
              type="text"
              name="tags"
              id="tags"
              value={formData.tags.join(',')}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
              className="block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
              placeholder="personal,work"
            />
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label
                htmlFor="activatesAt"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Activates At (optional)
              </label>
              <input
                type="datetime-local"
                name="activatesAt"
                id="activatesAt"
                value={formData.activatesAt}
                onChange={handleChange}
                className="date-picker block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="expiresAt"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Expires At (optional)
              </label>
              <input
                type="datetime-local"
                name="expiresAt"
                id="expiresAt"
                value={formData.expiresAt}
                onChange={handleChange}
                className="date-picker block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
              />
            </div>
          </div>

          {/* Hint for date format */}
          <div className="md:col-span-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tip: Leave date fields blank to skip. Your browser may format the datetime; both blank
              and valid ISO strings are accepted.
            </p>
          </div>

          <div className="md:col-span-2 border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password Protection
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Require a password to access this link
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    passwordProtectionEnabled: !prev.passwordProtectionEnabled,
                    password: prev.passwordProtectionEnabled ? '' : prev.password,
                  }))
                }
                className={`relative inline-flex h-8 w-14 sm:h-7 sm:w-12 items-center p-0.5 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  formData.passwordProtectionEnabled
                    ? 'bg-blue-600'
                    : 'bg-gray-200 dark:bg-gray-600'
                }`}
                role="switch"
                aria-checked={formData.passwordProtectionEnabled}
                aria-labelledby="password-toggle-label"
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-6 w-6 sm:h-5 sm:w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    formData.passwordProtectionEnabled ? 'translate-x-6 sm:translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {formData.passwordProtectionEnabled && (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="password" className="sr-only">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      id="password"
                      value={formData.password}
                      onChange={handleChange}
                      className="block w-full pr-10 px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base sm:text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
                      placeholder="Enter password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="mt-2 text-sm text-red-600">{fieldErrors.password}</p>
                  )}
                  {formData.password && (
                    <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-1">
                          <div
                            className={`h-1 w-4 rounded ${formData.password.length >= 8 ? 'bg-green-400' : 'bg-gray-300'}`}
                          />
                          <div
                            className={`h-1 w-4 rounded ${formData.password.length >= 12 ? 'bg-green-400' : 'bg-gray-300'}`}
                          />
                          <div
                            className={`h-1 w-4 rounded ${/[A-Z]/.test(formData.password) && /[0-9]/.test(formData.password) ? 'bg-green-400' : 'bg-gray-300'}`}
                          />
                        </div>
                        <span
                          className={
                            formData.password.length >= 8
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-gray-500'
                          }
                        >
                          {formData.password.length >= 8
                            ? 'Strong password'
                            : 'Minimum 8 characters'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                  <div className="flex">
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        🔒 Password Required
                      </h3>
                      <div className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                        Users will need to enter this password before they can access your link.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="md:col-span-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md transition-colors">
              <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="md:col-span-2 flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6">
            <button
              type="button"
              onClick={requestClose}
              className="w-full sm:w-auto px-4 py-3 sm:py-2 text-base sm:text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || reservedPathsLoading}
              className="w-full sm:w-auto px-4 py-3 sm:py-2 text-base sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors"
            >
              {loading ? 'Creating...' : reservedPathsLoading ? 'Loading...' : 'Create Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
