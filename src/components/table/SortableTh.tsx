'use client'

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { SortDirection } from '@/lib/useTableSort'

/**
 * Drop-in replacement for a plain <th> that adds click-to-sort. Matches the
 * `px-4 py-2 text-xs font-medium text-gray-500 uppercase` header styling
 * used across the app's report/list tables — pass `className` to extend it,
 * not replace it.
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
  className = '',
}: {
  label: React.ReactNode
  sortKey: string
  activeKey: string | null
  dir: SortDirection
  onSort: (key: string) => void
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  const active = activeKey === sortKey
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      role="columnheader"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hover:text-gray-700 ${alignClass} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {active ? (
          dir === 'asc' ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
        )}
      </span>
    </th>
  )
}
