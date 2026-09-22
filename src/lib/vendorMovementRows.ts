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

export interface PurchaseLineVendorMovements {
  /** vw_job_work_vendor_movements' vendor_delta for rows already tagged with the line. */
  deltaById: Map<string, number>
  /** Untagged processed-output rows attributed to the line via their source job line. */
  attributed: AttributedOutputRow[]
}

export interface AttributedOutputRow {
  id: string
  entry_type: string
  quantity: number
  entry_date: string
  createdAt: string
  reference_number: string | null
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  material_type_id: string | null
  material_size_id: string | null
  size_label: string | null
  companyName: string | null
  warehouseName: string | null
  materialDescription: string | null
  unit: string | null
  vendorDelta: number
}

/** Vendor-stock effects for one purchase line's movements — Purchase Line
 * Movements' "Balance at Vendor" column.
 *
 * `attributed` covers job-work OUTPUT_IN/CANCEL rows that carry no
 * purchase_line_id: fn_job_work_output_item_to_ledger() only tags the line
 * when the whole order has exactly one, so on a multi-line order the
 * processed output is untagged (56 rows as of 2026-09-22) and the line would
 * otherwise show its material still sitting at the vendor forever. Each is
 * attributed through its output item's source job line — the same link
 * vw_job_work_vendor_movements uses for cross-item output — and rows whose
 * source line is ambiguous are left out rather than guessed. */
export async function fetchPurchaseLineVendorMovements(purchaseLineId: string): Promise<PurchaseLineVendorMovements> {
  const empty: PurchaseLineVendorMovements = { deltaById: new Map(), attributed: [] }
  if (!PURCHASE_LINE_RE.test(purchaseLineId)) return empty
  const line = `'${purchaseLineId}'`

  const [deltas, attributed] = await Promise.all([
    hasuraRunSql(`
      SELECT v.id::text, v.vendor_delta::text
      FROM vw_job_work_vendor_movements v
      JOIN stock_ledger sl ON sl.id = v.id
      WHERE sl.purchase_line_id = ${line} OR sl.sub_purchase_line_id = ${line}`),
    hasuraRunSql(`
      SELECT sl.id::text, sl.entry_type, sl.quantity::text, sl.entry_date::text,
             to_char(sl.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00',
             COALESCE(sl.reference_number, ''), COALESCE(sl.reference_type, ''), COALESCE(sl.reference_id::text, ''),
             COALESCE(sl.notes, ''), sl.material_type_id::text, COALESCE(sl.material_size_id::text, ''),
             COALESCE(sl.size_label, ''), COALESCE(c.name, ''), COALESCE(w.name, ''),
             COALESCE(mt.description, ''), COALESCE(mt.unit, ''), v.vendor_delta::text
      FROM vw_job_work_vendor_movements v
      JOIN stock_ledger sl ON sl.id = v.id
      LEFT JOIN companies c ON c.id = sl.company_id
      LEFT JOIN warehouses w ON w.id = sl.warehouse_id
      LEFT JOIN material_types mt ON mt.id = sl.material_type_id
      JOIN (
        -- One order can post several identically-shaped output rows from
        -- different lines (e.g. two 1.210 coils of the same size). Rank both
        -- sides the same way and pair them off, so each row lands on exactly
        -- one source line instead of being dropped as ambiguous.
        SELECT r.id, o.purchase_line_id
        FROM (
          SELECT sl2.id, sl2.reference_id, sl2.material_type_id, sl2.material_size_id, ABS(sl2.quantity) AS quantity,
                 ROW_NUMBER() OVER (PARTITION BY sl2.reference_id, sl2.material_type_id, sl2.material_size_id, ABS(sl2.quantity)
                                    ORDER BY sl2.created_at, sl2.id) AS rn
          FROM stock_ledger sl2
          WHERE sl2.entry_type IN ('JOB_WORK_OUTPUT_IN', 'JOB_WORK_CANCEL')
            AND sl2.reference_type = 'job_work'
            AND sl2.purchase_line_id IS NULL AND sl2.sub_purchase_line_id IS NULL
        ) r
        JOIN (
          SELECT oi.job_work_order_id, oi.material_type_id, oi.material_size_id, oi.quantity, ji.purchase_line_id,
                 ROW_NUMBER() OVER (PARTITION BY oi.job_work_order_id, oi.material_type_id, oi.material_size_id, oi.quantity
                                    ORDER BY oi.created_at, oi.id) AS rn
          FROM job_work_output_items oi
          JOIN job_work_items ji
            ON ji.job_work_order_id = oi.job_work_order_id AND ji.job_line_id = oi.source_job_line_id
          WHERE ji.purchase_line_id IS NOT NULL
        ) o
          ON o.job_work_order_id = r.reference_id
         AND o.material_type_id = r.material_type_id
         AND o.material_size_id IS NOT DISTINCT FROM r.material_size_id
         AND o.quantity = r.quantity
         AND o.rn = r.rn
      ) src ON src.id = sl.id AND src.purchase_line_id = ${line}
      ORDER BY sl.entry_date, sl.created_at`),
  ])

  const deltaById = new Map<string, number>()
  for (const [id, delta] of deltas.result?.slice(1) ?? []) deltaById.set(id, Number(delta))

  return {
    deltaById,
    attributed: (attributed.result?.slice(1) ?? []).map((r) => ({
      id: r[0],
      entry_type: r[1],
      quantity: Number(r[2]),
      entry_date: r[3],
      createdAt: r[4],
      reference_number: r[5] || null,
      reference_type: r[6] || null,
      reference_id: r[7] || null,
      notes: r[8] || null,
      material_type_id: r[9] || null,
      material_size_id: r[10] || null,
      size_label: r[11] || null,
      companyName: r[12] || null,
      warehouseName: r[13] || null,
      materialDescription: r[14] || null,
      unit: r[15] || null,
      vendorDelta: Number(r[16]),
    })),
  }
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
