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
