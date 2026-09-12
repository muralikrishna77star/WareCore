const DAY_MS = 24 * 60 * 60 * 1000

/** Default {from, to} window: `days` back from the anchor (latest created_at
 * in the table), not from wall-clock today — so stale/imported data still
 * shows its most recently entered records instead of an empty range. */
export function defaultCreatedRange(maxCreatedAt: string | null | undefined, days = 15): { from: string; to: string } {
  const anchor = maxCreatedAt ? new Date(maxCreatedAt) : new Date()
  const start = new Date(anchor.getTime() - days * DAY_MS)
  return { from: start.toISOString().split('T')[0], to: anchor.toISOString().split('T')[0] }
}

/** Exclusive upper bound (start of the next day) so a date-only "to" filter
 * includes every record created during that entire day. */
export function nextDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

/** The day before a date-only string — used to compute an "as of the day
 * before this range starts" opening balance. */
export function prevDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Last day of `month` (1-12) in `year`, as YYYY-MM-DD. */
function endOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().split('T')[0]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export type ListingRangeParams = {
  from?: string
  to?: string
  month?: string
  year?: string
}

export type ListingRange = {
  from: string
  to: string
  /** '' when no month filter is applied — i.e. the range came from from/to. */
  month: string
  /** '' when no year filter is applied. */
  year: string
}

/**
 * Resolves a listing screen's date window from its query params.
 *
 * Month/Year win over an explicit from/to: they're a quick-select that
 * *derives* the range, so whatever from/to the URL still carries (typically
 * left over from the previous Apply) would otherwise silently fight the
 * month the user just picked.
 *   - month + year → that calendar month
 *   - year only    → that whole calendar year
 *   - month only   → that month of the anchor's year (the year the default
 *                    range lands in), so the control still does something
 *                    sensible on its own
 *   - neither      → explicit from/to, else the anchored default window
 */
export function resolveListingRange(
  params: ListingRangeParams,
  defaults: { from: string; to: string }
): ListingRange {
  const monthNum = Number(params.month)
  const yearNum = Number(params.year)
  const hasMonth = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
  const hasYear = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2999

  if (hasMonth || hasYear) {
    const year = hasYear ? yearNum : Number(defaults.to.slice(0, 4))
    if (hasMonth) {
      return {
        from: `${year}-${pad2(monthNum)}-01`,
        to: endOfMonth(year, monthNum),
        month: String(monthNum),
        year: String(year),
      }
    }
    return { from: `${year}-01-01`, to: `${year}-12-31`, month: '', year: String(year) }
  }

  return {
    from: params.from || defaults.from,
    to: params.to || defaults.to,
    month: '',
    year: '',
  }
}

/**
 * Descending year list spanning the data, for the Year dropdown. Always
 * includes the anchor year even when the table is empty, so the control is
 * never blank.
 */
export function yearOptionsFrom(
  minDate: string | null | undefined,
  maxDate: string | null | undefined
): number[] {
  const now = new Date().getUTCFullYear()
  const start = minDate ? Number(String(minDate).slice(0, 4)) : now
  const end = maxDate ? Number(String(maxDate).slice(0, 4)) : now
  const lo = Math.min(start, end)
  const hi = Math.max(start, end)
  const years: number[] = []
  for (let y = hi; y >= lo; y--) years.push(y)
  return years.length ? years : [now]
}
