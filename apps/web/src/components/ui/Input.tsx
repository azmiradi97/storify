import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  startIcon?: ReactNode
  endIcon?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, startIcon, endIcon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {startIcon && (
            <span className="absolute right-3 text-gray-400 pointer-events-none">{startIcon}</span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full rounded-md border-[1.5px] bg-gray-800 px-3 py-2 text-sm text-gray-100',
              'placeholder:text-gray-500 transition-all duration-fast',
              'border-gray-600 hover:border-gray-500',
              'focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(31_169_113/0.15)]',
              'disabled:bg-gray-900 disabled:border-gray-700 disabled:cursor-not-allowed disabled:opacity-60',
              error && 'border-danger-500 focus:border-danger-500 focus:shadow-[0_0_0_3px_rgb(239_68_68/0.12)]',
              startIcon && 'pr-10',
              endIcon && 'pl-10',
              className,
            )}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            {...props}
          />
          {endIcon && (
            <span className="absolute left-3 text-gray-400">{endIcon}</span>
          )}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-danger-500 flex items-center gap-1">
            <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-xs text-gray-500">
            {hint}
          </p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'
