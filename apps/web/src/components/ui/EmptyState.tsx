import type { ReactNode } from 'react'
import { Button } from './Button'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  /** Extra class on the root wrapper */
  className?: string
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 px-4 text-center ${className}`}>
      <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center text-brand-500/60 shrink-0">
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-gray-300">{title}</p>
        {description && <p className="text-xs text-gray-500 max-w-xs">{description}</p>}
      </div>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
