import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type CardVariant = 'default' | 'elevated' | 'flat' | 'brand'

interface CardProps {
  variant?: CardVariant
  children: ReactNode
  className?: string
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-gray-800 shadow-sm border border-gray-700',
  elevated: 'bg-gray-800 shadow-md border border-gray-700',
  flat: 'bg-gray-800 border border-gray-700',
  brand: 'bg-brand-100/50 border border-brand-500/40',
}

export function Card({ variant = 'default', children, className }: CardProps) {
  return (
    <div className={cn('rounded-xl p-sp-4', variantClasses[variant], className)}>
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  change?: { value: string; positive: boolean }
  accentColor?: string
  icon?: ReactNode
  /**
   * When provided, the card renders as a button and shows a hover state.
   * Use to wire dashboard cards to a pre-filtered detail page.
   */
  onClick?: () => void
}

export function StatCard({ label, value, change, accentColor = 'bg-brand-500', icon, onClick }: StatCardProps) {
  const inner = (
    <>
      <div className={cn('absolute top-0 right-0 w-1 h-full', accentColor)} />
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-gray-500 font-medium">{label}</span>
        {icon && <span className="text-gray-500">{icon}</span>}
      </div>
      <span className="font-numeric text-2xl font-bold num num-primary">{value}</span>
      {change && (
        <span className={cn('text-xs', change.positive ? 'text-success-500' : 'text-danger-500')}>
          {change.positive ? '▲' : '▼'} {change.value}
        </span>
      )}
    </>
  )

  const baseClasses = 'bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-700 flex flex-col gap-3 relative overflow-hidden'

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(baseClasses, 'text-right hover:border-gray-500 hover:bg-gray-750 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500')}
      >
        {inner}
      </button>
    )
  }
  return <div className={baseClasses}>{inner}</div>
}
