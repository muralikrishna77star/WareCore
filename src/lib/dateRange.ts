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
 *
 * `mustInclude` covers years the caller has to be able to display even when
 * the data does not reach them — notably a screen whose default period is
 * the CURRENT month while the ledger only holds older data. Without it the
 * select would be handed a value absent from its options and silently fall
 * back to showing "All years".
 */
export function yearOptionsFrom(
  minDate: string | null | undefined,
  maxDate: string | null | undefined,
  mustInclude: (number | string | null | undefined)[] = []
): number[] {
  const now = new Date().getUTCFullYear()
  const start = minDate ? Number(String(minDate).slice(0, 4)) : now
  const end = maxDate ? Number(String(maxDate).slice(0, 4)) : now

  const extras = mustInclude
    .map((v) => Number(v))
    .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2999)

  const candidates = [start, end, ...extras].filter((y) => Number.isInteger(y))
  const lo = Math.min(...candidates)
  const hi = Math.max(...candidates)
  const years: number[] = []
  for (let y = hi; y >= lo; y--) years.push(y)
  return years.length ? years : [now]
}

export type PeriodMode = 'month' | 'custom'

export type StatementPeriod = {
  from: string
  to: string
  /** '' unless the active period is a whole selected month. */
  month: string
  year: string
  mode: PeriodMode
  /** Human label for the title and the Excel header, e.g. "November 2024". */
  label: string
}

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/**
 * Resolves the Daywise Stock Statement's reporting period.
 *
 * Differs from resolveListingRange in two ways the statement needs:
 *  - A selected month that is the CURRENT month ends today, not on the last
 *    day of the month — a statement should not show a closing balance for
 *    dates that have not happened yet.
 *  - Month/Year populates From/To, but a From/To that disagrees with the
 *    selected month means the user edited a date afterwards, so the period
 *    becomes a custom range. (MonthYearFilter clears both inputs when a
 *    month is picked, so an untouched re-submit still matches and stays in
 *    month mode.)
 *
 * With nothing selected at all it returns the current month to date, which
 * is also what Reset restores.
 */
export function resolveStatementPeriod(
  params: ListingRangeParams,
  today: Date = new Date()
): StatementPeriod {
  const todayIso = isoDate(today)
  const currentMonth = today.getMonth() + 1
  const currentYear = today.getFullYear()

  const monthNum = Number(params.month)
  const yearNum = Number(params.year)
  const hasMonth = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12
  const hasYear = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2999

  const monthLabel = (m: number, y: number) => `${MONTH_NAMES[m - 1]} ${y}`

  if (hasMonth || hasYear) {
    const year = hasYear ? yearNum : currentYear
    const month = hasMonth ? monthNum : currentMonth
    const naturalFrom = `${year}-${pad2(month)}-01`
    // The running month stops at today; a finished month runs to its end.
    const isCurrentMonth = month === currentMonth && year === currentYear
    const naturalTo = isCurrentMonth ? todayIso : endOfMonth(year, month)

    const editedFrom = !!params.from && params.from !== naturalFrom
    const editedTo = !!params.to && params.to !== naturalTo
    if (editedFrom || editedTo) {
      const from = params.from || naturalFrom
      const to = params.to || naturalTo
      return { from, to, month: '', year: '', mode: 'custom', label: `${from} to ${to}` }
    }

    return {
      from: naturalFrom,
      to: naturalTo,
      month: String(month),
      year: String(year),
      mode: 'month',
      label: monthLabel(month, year),
    }
  }

  if (params.from || params.to) {
    const from = params.from || `${currentYear}-${pad2(currentMonth)}-01`
    const to = params.to || todayIso
    return { from, to, month: '', year: '', mode: 'custom', label: `${from} to ${to}` }
  }

  // Nothing selected — current month to date (also what Reset restores).
  return {
    from: `${currentYear}-${pad2(currentMonth)}-01`,
    to: todayIso,
    month: String(currentMonth),
    year: String(currentYear),
    mode: 'month',
    label: monthLabel(currentMonth, currentYear),
  }
}
