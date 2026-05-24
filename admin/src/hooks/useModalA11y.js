import { useEffect, useRef, useCallback } from 'react'

/**
 * H11: Modal accessibility hook.
 * - Traps Tab/Shift+Tab focus inside the modal container.
 * - Listens for Escape to call onClose (with dirty-check via shouldConfirmClose).
 * - Restores focus to the element that opened the modal on unmount.
 * - Locks body scroll while open.
 *
 * Usage:
 *   const ref = useModalA11y({ onClose, isDirty })
 *   return <div ref={ref}>...</div>
 */
export function useModalA11y({ onClose, isDirty = false, dirtyMessage = 'Discard unsaved changes?' } = {}) {
  const containerRef = useRef(null)
  const previouslyFocused = useRef(null)

  const requestClose = useCallback(() => {
    if (isDirty) {
      const ok = typeof window !== 'undefined' ? window.confirm(dirtyMessage) : true
      if (!ok) return
    }
    onClose?.()
  }, [isDirty, dirtyMessage, onClose])

  useEffect(() => {
    if (typeof document === 'undefined') return
    previouslyFocused.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevOverflow
      const el = previouslyFocused.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      } else if (e.key === 'Tab') {
        const container = containerRef.current
        if (!container) return
        const focusable = container.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  return { containerRef, requestClose }
}
