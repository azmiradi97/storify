import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 shadow-brand focus-visible:ring-brand-500 disabled:bg-brand-600/50',
  secondary:
    'bg-gray-700 text-gray-100 hover:bg-gray-600 focus-visible:ring-gray-400',
  outline:
    'border border-brand-500 text-brand-400 bg-transparent hover:bg-brand-900/30 focus-visible:ring-brand-500',
  ghost:
    'bg-transparent text-gray-400 hover:bg-gray-800 hover:text-gray-100 focus-visible:ring-gray-500',
  danger:
    'bg-danger-500 text-white hover:bg-danger-600 focus-visible:ring-danger-500 disabled:bg-danger-500/50',
  success:
    'bg-success-500 text-white hover:bg-success-600 focus-visible:ring-success-500 disabled:bg-success-500/50',
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'px-[10px] py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-[22px] py-[11px] text-base',
  xl: 'px-7 py-[14px] text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all duration-normal',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
