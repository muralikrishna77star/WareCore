// Entry types that move stock to/from a vendor under job work — used to
// derive a running "at Vendor" balance alongside the warehouse balance.
// JOB_WORK_OUTPUT_IN and JOB_WORK_CANCEL are only SOMETIMES vendor
// movements: an OUTPUT_IN counts when it's recorded against the same
// material as one of its order's inputs (no real conversion — the vendor
// handing the material back), and a CANCEL counts only when it reverses a
// vendor movement (not, say, an Output Materials line of a converted item
// that was corrected via Edit Order). vw_job_work_vendor_movements
// (migrations 123/142) is the single source of truth for both; use
// isVendorMovementRow() with fetchCountedOutputAndCancelIds()
// (src/lib/vendorMovementRows.ts) everywhere a vendor delta is computed.
export const VENDOR_MOVEMENT_TYPES = [
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_CANCEL',
  'JOB_WORK_TRANSFER_OUT',
  'JOB_WORK_TRANSFER_IN',
]

const ALWAYS_VENDOR_MOVEMENT_TYPES = new Set([
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_TRANSFER_OUT',
  'JOB_WORK_TRANSFER_IN',
])

/** "Does this stock_ledger row represent material moving to/from a job-work
 * vendor" check for reports that only have an item's OWN ledger rows in
 * hand. `countedOutputAndCancelIds` comes from
 * fetchCountedOutputAndCancelIds() for every job work order referenced in
 * the report's dataset.
 *
 * Known limit (migration 142): an Output Materials line recorded as a
 * DIFFERENT item than the input it consumed (source_job_line_id set) is
 * posted under the output item, so it never appears among the input item's
 * own rows and this check can't see it. The DB view attributes such rows
 * back to the input line; anything that must match the "At Vendor" card
 * exactly (the Item Stock Ledger report, the reconcile-items API) reads
 * that view instead of using this helper. */
export function isVendorMovementRow(
  entryType: string,
  ledgerId: string,
  countedOutputAndCancelIds: ReadonlySet<string>
): boolean {
  if (ALWAYS_VENDOR_MOVEMENT_TYPES.has(entryType)) return true
  if (entryType !== 'JOB_WORK_OUTPUT_IN' && entryType !== 'JOB_WORK_CANCEL') return false
  return countedOutputAndCancelIds.has(ledgerId)
}
