import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/format'

interface MoneyProps {
  value: number | string
  currency?: string
  className?: string
  size?: 'sm' | 'base' | 'lg' | 'xl'
  tone?: 'neutral' | 'income' | 'expense'
}

const sizeClasses = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
}

const toneClasses = {
  neutral: 'text-gray-100',
  income: 'text-success-500',
  expense: 'text-danger-500',
}

export function Money({ value, currency = 'ج.م', className, size = 'base', tone = 'neutral' }: MoneyProps) {
  const formatted = typeof value === 'number' ? formatMoney(value) : value

  return (
    <span
      dir="ltr"
      className={cn(
        'inline-block font-numeric num',
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      {formatted} {currency}
    </span>
  )
}
