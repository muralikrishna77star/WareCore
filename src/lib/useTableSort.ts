'use client'

import { useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'

/** A column's sortable value — string/number compare naturally; null/undefined always sort last regardless of direction. */
export type SortAccessor<T> = (row: T) => string | number | null | undefined

/**
 * Generic click-to-sort state for a table: tracks which column key is active
 * and its direction, and returns the rows already sorted against the
 * accessor map for the current key. Third click on the same column clears
 * the sort back to the original row order (not just direction toggling
 * forever) — accessors is keyed by the same string passed to `SortableTh`'s
 * `sortKey` prop.
 */
export function useTableSort<T>(
  rows: T[],
  accessors: Record<string, SortAccessor<T>>,
  initial?: { key: string; dir?: SortDirection }
) {
  const [sortKey, setSortKey] = useState<string | null>(initial?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDirection>(initial?.dir ?? 'asc')

  const toggleSort = (key: string) => {
    if (!accessors[key]) return
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return rows
    const get = accessors[sortKey]
    const withValues = rows.map((row, index) => ({ row, index, value: get(row) }))
    withValues.sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index
      if (a.value == null) return 1
      if (b.value == null) return -1
      let cmp: number
      if (typeof a.value === 'number' && typeof b.value === 'number') {
        cmp = a.value - b.value
      } else {
        cmp = String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' })
      }
      return cmp !== 0 ? cmp : a.index - b.index
    })
    const ordered = withValues.map((w) => w.row)
    return sortDir === 'asc' ? ordered : ordered.reverse()
  }, [rows, sortKey, sortDir, accessors])

  return { sortedRows, sortKey, sortDir, toggleSort }
}
