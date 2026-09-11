import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, children, footer, size = 'md', className }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Save caller focus → move into modal → restore on close; lock body scroll while open
  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      prevFocusRef.current?.focus()
      document.body.style.overflow = original
    }
  }, [open])

  // Escape + Tab trap (combined so a single removeEventListener cleans both)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  // Portal to <body> — same reason as Drawer: AppShell's animated <main>
  // creates a transform containing block, which traps `position: fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          // max-h cap + flex column so long modal bodies scroll inside
          // instead of pushing the footer off the screen.
          'relative w-full max-h-[calc(100vh-2rem)] bg-white rounded-xl shadow-xl border border-gray-700 animate-fade-in-up focus:outline-none',
          'flex flex-col',
          sizeClasses[size],
          className,
        )}
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <h2 id={titleId} className="text-lg font-semibold text-gray-100">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="shrink-0 w-9 h-9 rounded-md bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-gray-100 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-gray-700 flex gap-3 justify-end">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
