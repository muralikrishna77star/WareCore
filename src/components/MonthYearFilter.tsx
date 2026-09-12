'use client'

import { MONTH_NAMES } from '@/lib/dateRange'

const SELECT_CLASS =
  'rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'

/**
 * Month + Year quick-select for the transaction listings (Purchase, Sale,
 * Job Work). Picking either one derives the whole date window server-side —
 * see resolveListingRange() — so the From/To inputs are cleared on change to
 * keep the form honest about which filter is actually in effect.
 */
export function MonthYearFilter({
  month,
  year,
  yearOptions,
  onPick,
  compact = false,
}: {
  month: string
  year: string
  yearOptions: number[]
  /** Omit for plain <form> usage; supply to drive client-side state instead. */
  onPick?: (next: { month: string; year: string }) => void
  compact?: boolean
}) {
  const cls = compact
    ? 'rounded border border-gray-200 px-1.5 py-1 text-xs font-normal normal-case text-gray-700 focus:border-blue-400 focus:outline-none'
    : SELECT_CLASS

  // Without onPick there's no state owner, so the selects must be uncontrolled
  // or the user's pick wouldn't render (value would stay pinned to the prop).
  const bind = (v: string) => (onPick ? { value: v } : { defaultValue: v })

  const clearSiblingDates = (form: HTMLFormElement | null) => {
    if (!form) return
    const from = form.elements.namedItem('from') as HTMLInputElement | null
    const to = form.elements.namedItem('to') as HTMLInputElement | null
    if (from) from.value = ''
    if (to) to.value = ''
  }

  return (
    <>
      <select
        name="month"
        aria-label="Month"
        {...bind(month)}
        className={cls}
        onChange={(e) => {
          clearSiblingDates(e.currentTarget.form)
          onPick?.({ month: e.target.value, year })
        }}
      >
        <option value="">All months</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
      <select
        name="year"
        aria-label="Year"
        {...bind(year)}
        className={cls}
        onChange={(e) => {
          clearSiblingDates(e.currentTarget.form)
          onPick?.({ month, year: e.target.value })
        }}
      >
        <option value="">All years</option>
        {yearOptions.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </>
  )
}
