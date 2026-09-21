import { hasuraRunSql } from '@/lib/hasura/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids of the JOB_WORK_OUTPUT_IN / JOB_WORK_CANCEL rows on the given job work
 * orders that vw_job_work_vendor_movements (migration 142) counts as a vendor
 * movement of their OWN item — the input to isVendorMovementRow(). Reading
 * the view rather than re-deriving its rules keeps the Stock Statement,
 * Daywise Stock Statement and Vendorwise reports on the exact inclusion rules
 * the Item Stock Ledger and vw_current_vendor_stock use. Cross-item output
 * rows (is_cross_item_output) are excluded: the view counts them against the
 * input item, not their own — see the known limit on isVendorMovementRow. */
export async function fetchCountedOutputAndCancelIds(orderIds: Iterable<string>): Promise<Set<string>> {
  const ids = Array.from(new Set(orderIds)).filter((id) => UUID_RE.test(id))
  const counted = new Set<string>()
  if (ids.length === 0) return counted
  const res = await hasuraRunSql(`
    SELECT v.id::text
    FROM vw_job_work_vendor_movements v
    WHERE v.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
      AND NOT v.is_cross_item_output
      AND v.job_work_order_id IN (${ids.map((id) => `'${id}'::uuid`).join(',')})`)
  for (const [id] of res.result?.slice(1) ?? []) counted.add(id)
  return counted
}
