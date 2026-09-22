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

/** Purchase line ids are business codes like GI0524-0018 — anything outside
 * this shape never reaches the SQL below (hasuraRunSql runs as Hasura admin). */
const PURCHASE_LINE_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]{0,39}$/

/** How much vendor stock each of one purchase line's ledger rows moves, keyed
 * by row id — the input to Purchase Line Movements' "Balance at Vendor"
 * column. Read from vw_job_work_vendor_movements (migration 142), the same
 * view vw_current_vendor_stock uses, so the two can never disagree.
 *
 * Every job-work row carries its purchase line since migrations 150 and 151;
 * the 3 rows still untagged system-wide have no line to belong to (an output
 * with no source job line, and one cancel/re-post pair that nets to zero). */
export async function fetchPurchaseLineVendorDeltas(purchaseLineId: string): Promise<Map<string, number>> {
  const deltaById = new Map<string, number>()
  if (!PURCHASE_LINE_RE.test(purchaseLineId)) return deltaById
  const line = `'${purchaseLineId}'`

  const res = await hasuraRunSql(`
    SELECT v.id::text, v.vendor_delta::text
    FROM vw_job_work_vendor_movements v
    JOIN stock_ledger sl ON sl.id = v.id
    WHERE sl.purchase_line_id = ${line} OR sl.sub_purchase_line_id = ${line}`)
  for (const [id, delta] of res.result?.slice(1) ?? []) deltaById.set(id, Number(delta))
  return deltaById
}

/** A processed-output row (JOB_WORK_OUTPUT_IN, or the CANCEL correcting one)
 * posted under a DIFFERENT item than the input it consumed — e.g. 0.85X995
 * slit into 0.90X121. vw_job_work_vendor_movements (migration 142) counts it
 * against the INPUT item's vendor stock (material_type_id/material_size_id
 * here are the input's), never the output item's own, and it never moves
 * the input item's warehouse stock. Reports that build vendor balances from
 * an item's own ledger rows can't see these, so they fold them in as
 * vendor-only rows. */
export interface CrossItemVendorRow {
  id: string
  jobWorkOrderId: string
  companyId: string | null
  warehouseId: string | null
  materialTypeId: string
  materialSizeId: string | null
  entryType: string
  quantity: number
  entryDate: string
  createdAt: string
  vendorDelta: number
  referenceNumber: string | null
  /** The output item the input was processed into, e.g. "OT00006 0.90X121". */
  outputLabel: string
}

export async function fetchCrossItemVendorRows(scope: {
  toDate: string
  companyId?: string | null
  warehouseId?: string | null
  materialTypeId?: string | null
  /** undefined = any size; null = the size-less variant only. */
  materialSizeId?: string | null
  /** Restrict to these job work orders (a vendor filter); undefined = all. */
  jobWorkOrderIds?: string[]
}): Promise<CrossItemVendorRow[]> {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRe.test(scope.toDate)) return []
  const conditions = ['v.is_cross_item_output', `v.entry_date <= '${scope.toDate}'::date`]
  const uuid = (id: string) => `'${id}'::uuid`
  if (scope.companyId) {
    if (!UUID_RE.test(scope.companyId)) return []
    conditions.push(`v.company_id = ${uuid(scope.companyId)}`)
  }
  if (scope.warehouseId) {
    if (!UUID_RE.test(scope.warehouseId)) return []
    conditions.push(`v.warehouse_id = ${uuid(scope.warehouseId)}`)
  }
  if (scope.materialTypeId) {
    if (!UUID_RE.test(scope.materialTypeId)) return []
    conditions.push(`v.material_type_id = ${uuid(scope.materialTypeId)}`)
  }
  if (scope.materialSizeId !== undefined) {
    if (scope.materialSizeId === null) conditions.push('v.material_size_id IS NULL')
    else if (!UUID_RE.test(scope.materialSizeId)) return []
    else conditions.push(`v.material_size_id = ${uuid(scope.materialSizeId)}`)
  }
  if (scope.jobWorkOrderIds) {
    const ids = scope.jobWorkOrderIds.filter((id) => UUID_RE.test(id))
    if (ids.length === 0) return []
    conditions.push(`v.job_work_order_id IN (${ids.map(uuid).join(',')})`)
  }
  const res = await hasuraRunSql(`
    SELECT v.id::text, v.job_work_order_id::text, COALESCE(v.company_id::text, ''), COALESCE(v.warehouse_id::text, ''),
           v.material_type_id::text, COALESCE(v.material_size_id::text, ''), v.entry_type, v.quantity::text,
           v.entry_date::text, to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00',
           v.vendor_delta::text, COALESCE(sl.reference_number, ''),
           trim(COALESCE(im.item_code, '') || ' ' || COALESCE(v.own_size_label, ''))
    FROM vw_job_work_vendor_movements v
    JOIN stock_ledger sl ON sl.id = v.id
    LEFT JOIN job_work_output_items oi ON oi.id = v.output_item_id
    LEFT JOIN item_master im ON im.id = oi.item_master_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY v.entry_date, v.created_at`)
  return (res.result?.slice(1) ?? []).map((r) => ({
    id: r[0],
    jobWorkOrderId: r[1],
    companyId: r[2] || null,
    warehouseId: r[3] || null,
    materialTypeId: r[4],
    materialSizeId: r[5] || null,
    entryType: r[6],
    quantity: Number(r[7]),
    entryDate: r[8],
    createdAt: r[9],
    vendorDelta: Number(r[10]),
    referenceNumber: r[11] || null,
    outputLabel: r[12] || 'another item',
  }))
}
