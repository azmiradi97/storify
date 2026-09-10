import React, { useState, useRef, useEffect, useMemo } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import {
  format, parseISO, isValid,
  startOfMonth, endOfMonth, startOfYear, subDays, startOfWeek, endOfWeek,
} from 'date-fns'
import { arEG } from 'date-fns/locale'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface DateRangeValue {
  /** ISO date string `YYYY-MM-DD`, or empty string for unset. */
  from: string
  to: string
}

interface PresetDef {
  label: string
  range: () => DateRangeValue
}

interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (v: DateRangeValue) => void
  /** Show preset chips ("هذا الشهر", "آخر 7 أيام", …). Default true. */
  presets?: boolean
  /** Override the default preset list. */
  customPresets?: PresetDef[]
  /** Compact button styling — match small filter bars. Default false. */
  compact?: boolean
  className?: string
}

const toIso = (d: Date) => format(d, 'yyyy-MM-dd')
const fromIso = (s: string): Date | undefined => {
  if (!s) return undefined
  const d = parseISO(s)
  return isValid(d) ? d : undefined
}

const defaultPresets: PresetDef[] = [
  { label: 'اليوم', range: () => { const t = new Date(); return { from: toIso(t), to: toIso(t) } } },
  { label: 'هذا الأسبوع', range: () => {
    const t = new Date()
    return { from: toIso(startOfWeek(t, { weekStartsOn: 6 })), to: toIso(endOfWeek(t, { weekStartsOn: 6 })) }
  } },
  { label: 'هذا الشهر', range: () => {
    const t = new Date()
    return { from: toIso(startOfMonth(t)), to: toIso(endOfMonth(t)) }
  } },
  { label: 'آخر 30 يوم', range: () => {
    const t = new Date()
    return { from: toIso(subDays(t, 29)), to: toIso(t) }
  } },
  { label: 'هذا العام', range: () => {
    const t = new Date()
    return { from: toIso(startOfYear(t)), to: toIso(t) }
  } },
  { label: 'الكل', range: () => ({ from: '', to: '' }) },
]

export function DateRangePicker({
  value, onChange, presets = true, customPresets, compact = false, className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const selected: DateRange | undefined = useMemo(() => {
    const from = fromIso(value.from)
    const to = fromIso(value.to)
    if (!from && !to) return undefined
    return { from, to }
  }, [value.from, value.to])

  const display = useMemo(() => {
    if (!value.from && !value.to) return 'الكل'
    if (value.from && value.to) return `${value.from} — ${value.to}`
    return value.from || value.to
  }, [value.from, value.to])

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) { onChange({ from: '', to: '' }); return }
    onChange({
      from: range.from ? toIso(range.from) : '',
      to: range.to ? toIso(range.to) : range.from ? toIso(range.from) : '',
    })
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange({ from: '', to: '' })
  }

  const activePresets = customPresets ?? defaultPresets

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 bg-gray-800 border border-gray-700 rounded text-gray-100 focus:outline-none focus:border-brand-500 transition-colors',
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-2.5 text-sm min-h-[44px]',
          (value.from || value.to) ? (compact ? 'rounded-e-none' : 'rounded-e-none') : '',
        )}
      >
        <CalendarIcon className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
        <span className="font-mono whitespace-nowrap">{display}</span>
      </button>
      {(value.from || value.to) && (
        <button
          type="button"
          aria-label="مسح الفترة"
          onClick={clear}
          className={cn(
            'flex items-center justify-center bg-gray-800 border border-s-0 border-gray-700 rounded-e text-gray-500 hover:text-gray-300 hover:bg-gray-750 transition-colors focus:outline-none focus:border-brand-500',
            compact ? 'px-1.5 py-1 h-full' : 'px-2 min-h-[44px]',
          )}
        >
          <X className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        </button>
      )}

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-[100] bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 flex flex-col gap-3"
          style={{ minWidth: 320 }}
        >
          {presets && (
            <div className="flex flex-wrap gap-1.5">
              {activePresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { onChange(p.range()); setOpen(false) }}
                  className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-brand-600 hover:text-white transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <DayPicker
            mode="range"
            selected={selected}
            onSelect={handleRangeSelect}
            locale={arEG}
            dir="rtl"
            numberOfMonths={1}
            weekStartsOn={6}
            className="rdp-hesba"
          />
        </div>
      )}
    </div>
  )
}
