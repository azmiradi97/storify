import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'gray'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  dot?: boolean
  icon?: ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-600',
  info: 'bg-info-50 text-info-600',
  gray: 'bg-gray-800 text-gray-300',
}

const dotClasses: Record<BadgeVariant, string> = {
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  gray: 'bg-gray-500',
}

export function Badge({ variant = 'gray', children, dot, icon, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {dot && !icon && (
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClasses[variant])} aria-hidden="true" />
      )}
      {icon && <span className="w-3 h-3 shrink-0">{icon}</span>}
      {children}
    </span>
  )
}
