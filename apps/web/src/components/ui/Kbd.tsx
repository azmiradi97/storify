import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface KbdProps {
  children: ReactNode
  className?: string
}

/**
 * Small keyboard-shortcut badge. Use to surface non-obvious hotkeys next to
 * the action they trigger so power users discover them.
 *
 * `dir="ltr"` is set so combinations like `Ctrl+K` keep their natural reading
 * order even inside an RTL page.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-gray-700 bg-gray-750 text-gray-400 font-mono text-[10px] leading-none shadow-sm',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
