// Review & Fix on Data Integrity → Stock Reconciliation (migration 163):
// a diagnosis finding can carry one of these fixes. The fix route re-checks
// everything in the database before changing anything.

export type ReconcileFix =
  | {
      // Two legs of one movement (vendor direct sale, or vendor transfer)
      // recorded at different moments — gives the later leg the earlier
      // leg's timestamp. No quantity or date changes.
      kind: 'align_pair_timestamp'
      ledgerId: string
      partnerId: string
    }
  | {
      // An Output Materials line dated before its job work was sent — moves
      // it to a corrected date the user confirms.
      kind: 'output_received_date'
      outputItemId: string
      currentDate: string
      proposedDate: string
      minDate: string
    }

export type ReconcileFixRequest =
  | { kind: 'align_pair_timestamp'; itemId: string; ledgerId: string; partnerId: string }
  | { kind: 'output_received_date'; itemId: string; outputItemId: string; newDate: string }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Most mis-dated outputs are a mistyped year (GA00192: 14-Feb-2024 on a job
 * sent 12-Feb-2025). Suggest the same day and month in the year the job was
 * sent — or the year after, if that is still before it — capped at today.
 */
export function proposeReceivedDate(currentDate: string, dispatchDate: string, today: string): string {
  const [, mm, dd] = currentDate.split('-')
  let year = Number(dispatchDate.slice(0, 4))
  const build = (y: number) => {
    const d = new Date(Date.UTC(y, Number(mm) - 1, Number(dd)))
    // 29-Feb in a non-leap year rolls into March; fall back to 28-Feb.
    if (d.getUTCMonth() !== Number(mm) - 1) d.setUTCDate(0)
    return d.toISOString().slice(0, 10)
  }
  let proposed = build(year)
  if (proposed < dispatchDate) proposed = build(++year)
  if (proposed > today) proposed = dispatchDate
  return proposed
}
