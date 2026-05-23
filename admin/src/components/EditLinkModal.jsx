import { useMemo, useState } from 'react'
import { X, Eye, EyeOff } from 'lucide-react'
import { workerHost } from '../services/links'
import { useModalA11y } from '../hooks/useModalA11y'

export function EditLinkModal({ link, onSave, onClose }) {
  // Helper to convert ISO -> value accepted by <input type="datetime-local">
  const toLocalInput = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return ''
      const tzOffset = d.getTimezoneOffset()
      const local = new Date(d.getTime() - tzOffset * 60000)
      return local.toISOString().slice(0, 16)
    } catch {
      return ''
    }
  }

  const initial = useMemo(() => ({
    url: link.url || '',
    description: link.description || '',
    redirectType: link.redirectType || 301,
    tags: Array.isArray(link.tags) ? link.tags : [],
    archived: !!link.archived,
    activatesAt: toLocalInput(link.activatesAt),
    expiresAt: toLocalInput(link.expiresAt),
    password: '',
    passwordProtectionEnabled: !!link.passwordEnabled,
  }), [link])

  const [formData, setFormData] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  // Detect dirty state to disable save if nothing changed
  const isDirty = useMemo(() => {
    const normTags = (t) => (Array.isArray(t) ? t.map((s) => s.trim()).filter(Boolean) : [])
    const a = {
      ...initial,
      url: (initial.url || '').trim(),
      description: (initial.description || '').trim(),
      tags: normTags(initial.tags),
    }
    const b = {
      ...formData,
      url: (formData.url || '').trim(),
      description: (formData.description || '').trim(),
      tags: normTags(formData.tags),
    }
    const keys = [
      'url',
      'description',
      'redirectType',
      'archived',
      'activatesAt',
      'expiresAt',
      'passwordProtectionEnabled',
    ]
    const sameScalars = keys.every((k) => a[k] === b[k])
    const sameTags = a.tags.join(',') === b.tags.join(',')
    // Password content doesn't affect enablement if protection is off
    const passwordRelevant = b.passwordProtectionEnabled
      ? a.password === b.password // both are empty most times; keeps logic simple
      : true
    return !(sameScalars && sameTags && passwordRelevant)
  }, [initial, formData])

  // H11: focus trap + Esc + dirty confirm. Replaces the bare Esc listener
  // and unguarded backdrop click.
  const { containerRef, requestClose } = useModalA11y({ onClose, isDirty })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!formData.url.trim()) {
      setError('URL is required')
      return
    }

    if (!/^https?:\/\/.+/.test(formData.url)) {
      setError('URL must start with http:// or https://')
      return
    }

    try {
      setLoading(true)
      const toISO = (s) =>
        s && typeof s === 'string' && s.trim() !== '' ? new Date(s).toISOString() : undefined
      const payload = {
        url: formData.url,
        description: formData.description,
        redirectType: formData.redirectType,
        tags: Array.isArray(formData.tags) ? formData.tags : [],
        archived: !!formData.archived,
        activatesAt: toISO(formData.activatesAt),
        expiresAt: toISO(formData.expiresAt),
        password: !formData.passwordProtectionEnabled
          ? null
          : formData.password.trim() || undefined,
      }
      await onSave(payload)
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'redirectType' ? parseInt(value) : value,
    }))
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-sm backdrop-saturate-150 z-50 transition duration-200 ease-out flex items-start sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-link-title"
    >
      <div
        ref={containerRef}
        className="mx-auto w-screen sm:w-full h-[100svh] sm:h-auto max-w-none sm:max-w-2xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 shadow-lg rounded-none sm:rounded-md bg-white dark:bg-gray-800 transition-colors overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 border-b border-gray-200 dark:border-gray-700 sm:border-0">
          <h3 id="edit-link-title" className="text-lg font-medium text-gray-900 dark:text-white">Edit Link</h3>
          <button
            onClick={requestClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            aria-label="Close edit link dialog"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-md transition-colors">
          <div className="text-sm text-gray-600 dark:text-gray-300">Short Link</div>
          <div className="font-mono text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded mt-1 transition-colors">
            {workerHost()}/{link.shortcode}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Destination URL *
            </label>
            <input
              type="url"
              name="url"
              id="url"
              value={formData.url}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
              placeholder="https://example.com"
              required
              autoFocus
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Description
            </label>
            <input
              type="text"
              name="description"
              id="description"
              value={formData.description}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label
              htmlFor="redirectType"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Redirect Type
            </label>
            <select
              name="redirectType"
              id="redirectType"
              value={formData.redirectType}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
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
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Tags (comma separated)
            </label>
            <input
              type="text"
              name="tags"
              id="tags"
              value={(formData.tags || []).join(',')}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tags: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
              className="mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
              placeholder="personal,work"
            />
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="activatesAt"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Activates At (optional)
              </label>
              <input
                type="datetime-local"
                name="activatesAt"
                id="activatesAt"
                value={formData.activatesAt}
                onChange={handleChange}
                className="date-picker mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="expiresAt"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Expires At (optional)
              </label>
              <input
                type="datetime-local"
                name="expiresAt"
                id="expiresAt"
                value={formData.expiresAt}
                onChange={handleChange}
                className="date-picker mt-1 block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="md:col-span-1 flex items-center space-x-2">
            <input
              id="archived"
              name="archived"
              type="checkbox"
              checked={!!formData.archived}
              onChange={(e) => setFormData((prev) => ({ ...prev, archived: e.target.checked }))}
              className="h-4 w-4 text-blue-600 border-gray-300 rounded"
            />
            <label htmlFor="archived" className="text-sm text-gray-700 dark:text-gray-300">
              Archived
            </label>
          </div>

          <div className="md:col-span-2 border-t border-gray-200 dark:border-gray-700 pt-4">
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
                className={`relative inline-flex h-7 w-12 items-center p-0.5 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
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
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    formData.passwordProtectionEnabled ? 'translate-x-5' : 'translate-x-0'
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
                      className={`block w-full px-3 py-3 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors ${link.passwordEnabled ? 'pr-40' : 'pr-10'}`}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={
                        link.passwordEnabled
                          ? 'Enter new password (leave blank to keep current)'
                          : 'Enter password'
                      }
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
                    {link.passwordEnabled && (
                      <div className="absolute inset-y-0 right-10 pr-3 flex items-center pointer-events-none">
                        <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded">
                          Currently Protected
                        </span>
                      </div>
                    )}
                  </div>
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

                {!formData.password && link.passwordEnabled && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                    <div className="flex">
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                          Keep Current Password
                        </h3>
                        <div className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                          Leave the password field empty to keep your existing password unchanged.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="md:col-span-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md transition-colors">
              <p className="text-red-800 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="md:col-span-2 flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={requestClose}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !isDirty}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors"
              aria-disabled={loading || !isDirty}
            >
              {loading ? 'Saving...' : isDirty ? 'Save Changes' : 'No Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
