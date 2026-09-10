import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
  headerClassName?: string
}

/**
 * Optional selection contract — pass to enable a leading checkbox column.
 * Designed to plug directly into `useSelection`.
 */
export interface TableSelection<T> {
  isSelected: (row: T) => boolean
  onToggle: (row: T) => void
  /** Toggle every row currently rendered. */
  onToggleAll: () => void
  /** Whether every currently-rendered row is selected. */
  allSelected: boolean
  /** Whether at least one currently-rendered row is selected (for indeterminate state). */
  someSelected: boolean
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T) => string
  onRowClick?: (row: T) => void
  emptyMessage?: string
  className?: string
  selection?: TableSelection<T>
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'لا توجد بيانات',
  className,
  selection,
}: TableProps<T>) {
  const totalCols = columns.length + (selection ? 1 : 0)
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-gray-700', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 bg-gray-900">
            {selection && (
              <th className="w-10 px-3 py-3">
                <CheckboxCell
                  checked={selection.allSelected}
                  indeterminate={!selection.allSelected && selection.someSelected}
                  onChange={selection.onToggleAll}
                  aria-label="تحديد الكل"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-end px-4 py-3 text-xs uppercase tracking-wider text-gray-500 font-medium',
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="text-center py-12 text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => {
              const isSelected = selection?.isSelected(row) ?? false
              return (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) } } : undefined}
                  className={cn(
                    'border-b border-gray-700/50 transition-colors duration-fast',
                    isSelected ? 'bg-brand-500/10' : 'bg-gray-800 hover:bg-gray-700/50',
                    onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',
                  )}
                >
                  {selection && (
                    <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <CheckboxCell
                        checked={isSelected}
                        onChange={() => selection.onToggle(row)}
                        aria-label="تحديد الصف"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3 text-gray-300', col.className)}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

interface CheckboxCellProps {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  'aria-label'?: string
}

function CheckboxCell({ checked, indeterminate, onChange, 'aria-label': ariaLabel }: CheckboxCellProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = !!indeterminate && !checked }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
      className="w-4 h-4 accent-brand-500 cursor-pointer rounded border-gray-600 bg-gray-700"
    />
  )
}
