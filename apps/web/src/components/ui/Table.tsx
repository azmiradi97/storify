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
          <tr className="border-b border-gray-700 bg-gray-750">
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
              <td colSpan={totalCols} className="text-center py-14">
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
                  </svg>
                  <span className="text-sm">{emptyMessage}</span>
                </div>
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
