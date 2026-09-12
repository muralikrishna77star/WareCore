/**
 * Day-Wise Item Ledger — server-side data assembly.
 *
 * Fetches the ledger rows for the active filter, then resolves each row's
 * item, financial, party and audit detail from lookup maps. Nothing here
 * joins the ledger to a detail table row-to-row: every lookup is a Map
 * keyed by a value proven unique (or deliberately pre-aggregated), so a
 * ledger row can never be multiplied by its own enrichment.
 *
 * Pure classification/valuation/grouping lives in ./dayWiseItemLedger.ts;
 * this module is the I/O half.
 */
import { hasuraQuery, hasuraRunSql } from '@/lib/hasura/server'
import {
  DAY_WISE_ITEM_LEDGER_QUERY,
  DAY_WISE_ITEM_LEDGER_COUNT_QUERY,
  DAY_WISE_LEDGER_PURCHASE_LINES_QUERY,
  DAY_WISE_LEDGER_DISPATCH_ITEMS_QUERY,
  DAY_WISE_LEDGER_DISPATCH_ORDERS_QUERY,
  DAY_WISE_LEDGER_JOB_WORK_ORDERS_QUERY,
  DAY_WISE_LEDGER_TRANSFERS_QUERY,
  DAY_WISE_LEDGER_ITEM_MASTER_QUERY,
  USER_PROFILES_QUERY,
} from '@/lib/hasura/queries'
import {
  ENTRY_TYPE_META,
  buildDetailRow,
  buildReport,
  type DetailRow,
  type EntryType,
  type LedgerReport,
  type LedgerRow,
  type PartyNames,
  type ReconciliationFlag,
  type RowContext,
  type SourceFinancials,
  normalizeStatus,
  QTY_EPSILON,
  roundQty,
  verifyTotals,
} from '@/lib/dayWiseItemLedger'

/** Hard cap on detail rows fetched in one run. */
export const DAY_WISE_LEDGER_LIMIT = 5000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Opening / closing stock for one item + size within the report's scope.
 *
 * Deliberately computed over ALL entry types, ignoring the transaction-type,
 * party and document filters: a stock balance that only counted the rows a
 * user happened to filter to would not be a balance. closing always equals
 * opening + periodInward - periodOutward.
 */
export type StockPosition = {
  materialTypeId: string
  materialSizeId: string | null
  itemCode: string
  itemDescription: string
  itemSize: string
  unit: string
  opening: number
  periodInward: number
  periodOutward: number
  closing: number
}

const num = (v: unknown): number | null =>
  v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null

export type DayWiseFilters = {
  fromDate: string
  toDate: string
  companyIds: string[]
  warehouseIds: string[]
  itemMasterIds: string[]
  materialSizeIds: string[]
  entryTypes: string[]
  supplierIds: string[]
  customerIds: string[]
  jobWorkerIds: string[]
  documentNumber: string
  includeCancelled: boolean
}

export type DayWiseLedgerResult = {
  report: LedgerReport
  /** Total rows matching the filter, before the row cap. */
  matchedCount: number
  truncated: boolean
  /** Problems found by the post-build totals check; empty when consistent. */
  integrityProblems: string[]
  /** Opening / closing stock per item + size, over ALL entry types. */
  stockPositions: StockPosition[]
  /** Sum of stockPositions, for the headline strip. */
  stockTotals: { opening: number; periodInward: number; periodOutward: number; closing: number }
  /**
   * True when a transaction-type / party / document filter is narrowing the
   * listed transactions, so the stock position covers more than what is shown.
   */
  stockScopeBroaderThanList: boolean
}

/**
 * Builds the stock_ledger bool_exp for the active filters.
 *
 * Item and size selections are translated into their underlying
 * material_type_id / material_size_id keys by the caller, because
 * stock_ledger stores material keys, not item_master_id.
 */
export function buildLedgerWhere(
  f: DayWiseFilters,
  itemMaterialKeys: { materialTypeIds: string[]; materialSizeIds: string[] }
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [
    { entry_date: { _gte: f.fromDate } },
    { entry_date: { _lte: f.toDate } },
  ]

  if (f.companyIds.length) and.push({ company_id: { _in: f.companyIds } })
  if (f.warehouseIds.length) and.push({ warehouse_id: { _in: f.warehouseIds } })
  if (itemMaterialKeys.materialTypeIds.length) {
    and.push({ material_type_id: { _in: itemMaterialKeys.materialTypeIds } })
  }
  // An explicit size filter wins; otherwise the sizes implied by the chosen items.
  const sizeIds = f.materialSizeIds.length ? f.materialSizeIds : itemMaterialKeys.materialSizeIds
  if (sizeIds.length) and.push({ material_size_id: { _in: sizeIds } })

  const types = f.entryTypes.length
    ? f.entryTypes
    : f.includeCancelled
      ? []
      : (Object.keys(ENTRY_TYPE_META) as EntryType[]).filter((t) => !ENTRY_TYPE_META[t].isCancellation)
  if (types.length) and.push({ entry_type: { _in: types } })

  // Cancelled source documents are excluded by default. The ledger keeps the
  // reversing row either way, so this filters the postings, not history.
  if (!f.includeCancelled && f.entryTypes.length) {
    const nonCancel = f.entryTypes.filter((t) => !ENTRY_TYPE_META[t as EntryType]?.isCancellation)
    if (nonCancel.length !== f.entryTypes.length) {
      and[and.length - 1] = { entry_type: { _in: nonCancel } }
    }
  }

  if (f.documentNumber.trim()) {
    and.push({ reference_number: { _ilike: `%${f.documentNumber.trim()}%` } })
  }

  return { _and: and }
}

type LedgerQueryRow = LedgerRow & {
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string; code?: string | null } | null
  material_sizes?: { size_label: string } | null
}

type ItemMasterRow = {
  id: string
  item_code: string
  item_name: string
  unit: string | null
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
}

const uuidOnly = (ids: (string | null | undefined)[]): string[] =>
  Array.from(new Set(ids.filter((v): v is string => !!v)))

/**
 * Loads opening / period / closing stock per item + size.
 *
 * Uses run_sql because this needs a GROUP BY aggregate, which Hasura's
 * GraphQL aggregates cannot express. Every interpolated value is a
 * regex-validated UUID or YYYY-MM-DD date and nothing else reaches the
 * string — no free text, no user-supplied search terms. (See
 * project_sql_injection_fix_2026_09_02: unescaped values reaching
 * hasuraRunSql, which runs with full admin rights, is a known trap here.)
 */
async function loadStockPositions(
  f: DayWiseFilters,
  itemMaterialKeys: { materialTypeIds: string[]; materialSizeIds: string[] }
): Promise<Map<string, { opening: number; periodInward: number; periodOutward: number }>> {
  const map = new Map<string, { opening: number; periodInward: number; periodOutward: number }>()
  if (!DATE_RE.test(f.fromDate) || !DATE_RE.test(f.toDate)) return map

  const inClause = (column: string, ids: string[]): string => {
    const safe = ids.filter((id) => UUID_RE.test(id))
    if (!safe.length) return ''
    return ` AND ${column} IN (${safe.map((id) => `'${id}'::uuid`).join(',')})`
  }

  const sizeIds = f.materialSizeIds.length ? f.materialSizeIds : itemMaterialKeys.materialSizeIds

  const sql = `
    SELECT
      material_type_id::text,
      COALESCE(material_size_id::text, ''),
      COALESCE(SUM(CASE WHEN entry_date < '${f.fromDate}'::date THEN quantity ELSE 0 END), 0)::text,
      COALESCE(SUM(CASE WHEN entry_date >= '${f.fromDate}'::date AND quantity > 0 THEN quantity ELSE 0 END), 0)::text,
      COALESCE(SUM(CASE WHEN entry_date >= '${f.fromDate}'::date AND quantity < 0 THEN -quantity ELSE 0 END), 0)::text
    FROM stock_ledger
    WHERE entry_date <= '${f.toDate}'::date${inClause('company_id', f.companyIds)}${inClause(
      'warehouse_id',
      f.warehouseIds
    )}${inClause('material_type_id', itemMaterialKeys.materialTypeIds)}${inClause('material_size_id', sizeIds)}
    GROUP BY 1, 2
  `

  const result = await hasuraRunSql(sql)
  for (const row of result.result?.slice(1) ?? []) {
    const [matId, sizeId, opening, periodIn, periodOut] = row
    map.set(`${matId}|${sizeId}`, {
      opening: Number(opening) || 0,
      periodInward: Number(periodIn) || 0,
      periodOutward: Number(periodOut) || 0,
    })
  }
  return map
}

/**
 * Loads and assembles the report.
 *
 * `partyFilter` is applied after enrichment because supplier/customer/job
 * worker live on the source document, not on stock_ledger — filtering them
 * in SQL would need exactly the ledger-to-document join this report avoids.
 */
export async function loadDayWiseItemLedger(
  filters: DayWiseFilters,
  itemMaterialKeys: { materialTypeIds: string[]; materialSizeIds: string[] }
): Promise<DayWiseLedgerResult> {
  const where = buildLedgerWhere(filters, itemMaterialKeys)

  const [ledgerResult, countResult, rawPositions] = await Promise.all([
    hasuraQuery(DAY_WISE_ITEM_LEDGER_QUERY, { where, limit: DAY_WISE_LEDGER_LIMIT }),
    hasuraQuery(DAY_WISE_ITEM_LEDGER_COUNT_QUERY, { where }),
    loadStockPositions(filters, itemMaterialKeys),
  ])

  const rows: LedgerQueryRow[] = ledgerResult.stock_ledger ?? []
  const matchedCount: number = countResult.stock_ledger_aggregate?.aggregate?.count ?? rows.length

  const purchaseLineIds = uuidOnly(rows.map((r) => r.purchase_line_id))
  const dispatchIds = uuidOnly(rows.filter((r) => r.reference_type === 'dispatch').map((r) => r.reference_id))
  const jobWorkIds = uuidOnly(rows.filter((r) => r.reference_type === 'job_work').map((r) => r.reference_id))
  // Transfer ledger rows written by the inter-company backfill migrations
  // carry reference_number but a NULL reference_id, so this list is usually
  // empty — filtering nulls out keeps the uuid! variable valid.
  const transferIds = uuidOnly(rows.filter((r) => r.reference_type === 'transfer').map((r) => r.reference_id))
  const createdByIds = uuidOnly(rows.map((r) => r.created_by))

  const [purchaseLines, dispatchItems, dispatchOrders, jobWorkOrders, transfers, itemMasters, users] =
    await Promise.all([
      purchaseLineIds.length
        ? hasuraQuery(DAY_WISE_LEDGER_PURCHASE_LINES_QUERY, { line_ids: purchaseLineIds })
        : Promise.resolve({ purchase_bill_items: [] }),
      dispatchIds.length
        ? hasuraQuery(DAY_WISE_LEDGER_DISPATCH_ITEMS_QUERY, { order_ids: dispatchIds })
        : Promise.resolve({ dispatch_items: [] }),
      dispatchIds.length
        ? hasuraQuery(DAY_WISE_LEDGER_DISPATCH_ORDERS_QUERY, { ids: dispatchIds })
        : Promise.resolve({ dispatch_orders: [] }),
      jobWorkIds.length
        ? hasuraQuery(DAY_WISE_LEDGER_JOB_WORK_ORDERS_QUERY, { ids: jobWorkIds })
        : Promise.resolve({ job_work_orders: [] }),
      transferIds.length
        ? hasuraQuery(DAY_WISE_LEDGER_TRANSFERS_QUERY, { ids: transferIds })
        : Promise.resolve({ transfers: [] }),
      hasuraQuery(DAY_WISE_LEDGER_ITEM_MASTER_QUERY),
      createdByIds.length ? hasuraQuery(USER_PROFILES_QUERY) : Promise.resolve({ user_profiles: [] }),
    ])

  // ── Lookup maps ───────────────────────────────────────────────────────

  type PurchaseLine = {
    purchase_line_id: string
    item_master_id: string | null
    item_name: string | null
    quantity: unknown
    received_quantity: unknown
    rate: unknown
    amount: unknown
    taxable_value: unknown
    cgst_rate: unknown
    cgst_amount: unknown
    sgst_rate: unknown
    sgst_amount: unknown
    total_with_tax: unknown
    purchase_bills?: {
      id: string
      bill_number: string | null
      status: string | null
      suppliers?: { name: string } | null
    } | null
    item_master?: { item_code: string; item_name: string; unit: string | null } | null
  }

  // purchase_line_id is unique in purchase_bill_items (verified), so this
  // map is 1:1 and can never multiply a ledger row.
  const lineMap = new Map<string, PurchaseLine>()
  for (const l of (purchaseLines.purchase_bill_items ?? []) as PurchaseLine[]) {
    if (l.purchase_line_id) lineMap.set(l.purchase_line_id, l)
  }

  type DispatchItem = {
    dispatch_order_id: string
    material_type_id: string
    material_size_id: string | null
    item_master_id: string | null
    purchase_line_id: string | null
    quantity: unknown
    rate: unknown
    amount: unknown
    taxable_value: unknown
    cgst_rate: unknown
    cgst_amount: unknown
    sgst_rate: unknown
    sgst_amount: unknown
    total_with_tax: unknown
    item_master?: { item_code: string; item_name: string; unit: string | null } | null
  }

  // Pre-aggregated by (order, material, size): production has 3 groups where
  // one order holds several lines of the same material/size, which a direct
  // join would turn into duplicate ledger rows. Summing here collapses them
  // into the single figure the one ledger row represents.
  type DispatchBucket = SourceFinancials & {
    itemMasterId: string | null
    itemCode: string | null
    itemName: string | null
    unit: string | null
    lineCount: number
  }
  const dispatchBuckets = new Map<string, DispatchBucket>()
  // Keyed by purchase line first: stock_ledger posts one SALE_OUT per
  // purchase line, and dispatch_items records the same breakdown, so
  // including it matches the two exactly instead of merging lines that the
  // ledger kept apart and then pro-rating them back out. The purchase-line
  // -less key is the fallback for rows that predate that tagging.
  const dispatchKey = (
    orderId: string,
    matId: string,
    sizeId: string | null | undefined,
    purchaseLineId?: string | null
  ) => `${orderId}|${matId}|${sizeId ?? ''}|${purchaseLineId ?? ''}`

  for (const di of (dispatchItems.dispatch_items ?? []) as DispatchItem[]) {
    const key = dispatchKey(di.dispatch_order_id, di.material_type_id, di.material_size_id, di.purchase_line_id)
    const existing = dispatchBuckets.get(key)
    const add = (a: number | null, b: number | null): number | null =>
      a == null && b == null ? null : (a ?? 0) + (b ?? 0)
    if (!existing) {
      dispatchBuckets.set(key, {
        sourceQuantity: num(di.quantity) ?? 0,
        rate: num(di.rate),
        basicAmount: num(di.taxable_value) ?? num(di.amount),
        cgstRate: num(di.cgst_rate),
        sgstRate: num(di.sgst_rate),
        cgstAmount: num(di.cgst_amount),
        sgstAmount: num(di.sgst_amount),
        totalWithTax: num(di.total_with_tax),
        itemMasterId: di.item_master_id,
        itemCode: di.item_master?.item_code ?? null,
        itemName: di.item_master?.item_name ?? null,
        unit: di.item_master?.unit ?? null,
        lineCount: 1,
      })
    } else {
      existing.sourceQuantity += num(di.quantity) ?? 0
      existing.basicAmount = add(existing.basicAmount, num(di.taxable_value) ?? num(di.amount))
      existing.cgstAmount = add(existing.cgstAmount, num(di.cgst_amount))
      existing.sgstAmount = add(existing.sgstAmount, num(di.sgst_amount))
      existing.totalWithTax = add(existing.totalWithTax, num(di.total_with_tax))
      existing.lineCount += 1
      // A blended rate is the only honest one once lines are merged.
      existing.rate =
        existing.basicAmount != null && existing.sourceQuantity > 0
          ? existing.basicAmount / existing.sourceQuantity
          : existing.rate
    }
  }

  // Fallback bucket ignoring the purchase line, for ledger rows written
  // before SALE_OUT carried purchase_line_id.
  const dispatchBucketsNoLine = new Map<string, DispatchBucket>()
  for (const [key, bucket] of dispatchBuckets) {
    const looseKey = key.split('|').slice(0, 3).join('|')
    const existing = dispatchBucketsNoLine.get(looseKey)
    if (!existing) {
      dispatchBucketsNoLine.set(looseKey, { ...bucket })
    } else {
      const add = (a: number | null, b: number | null): number | null =>
        a == null && b == null ? null : (a ?? 0) + (b ?? 0)
      existing.sourceQuantity += bucket.sourceQuantity
      existing.basicAmount = add(existing.basicAmount, bucket.basicAmount)
      existing.cgstAmount = add(existing.cgstAmount, bucket.cgstAmount)
      existing.sgstAmount = add(existing.sgstAmount, bucket.sgstAmount)
      existing.totalWithTax = add(existing.totalWithTax, bucket.totalWithTax)
      existing.lineCount += bucket.lineCount
      existing.rate =
        existing.basicAmount != null && existing.sourceQuantity > 0
          ? existing.basicAmount / existing.sourceQuantity
          : existing.rate
    }
  }

  /** Exact purchase-line match when the ledger row has one, else the loose key. */
  const findDispatchBucket = (
    orderId: string | null | undefined,
    matId: string,
    sizeId: string | null | undefined,
    purchaseLineId: string | null | undefined
  ): DispatchBucket | undefined => {
    if (!orderId) return undefined
    if (purchaseLineId) {
      const exact = dispatchBuckets.get(dispatchKey(orderId, matId, sizeId, purchaseLineId))
      if (exact) return exact
    }
    return dispatchBucketsNoLine.get(`${orderId}|${matId}|${sizeId ?? ''}`)
  }

  type DispatchOrder = {
    id: string
    invoice_number: string | null
    sale_ref_id: string | null
    status: string | null
    is_vendor_direct: boolean | null
    customers?: { name: string } | null
    companies?: { name: string } | null
    warehouses?: { name: string } | null
  }
  const dispatchOrderMap = new Map<string, DispatchOrder>()
  for (const o of (dispatchOrders.dispatch_orders ?? []) as DispatchOrder[]) dispatchOrderMap.set(o.id, o)

  type JobWorkOrder = {
    id: string
    reference_number: string | null
    status: string | null
    suppliers?: { name: string } | null
    companies?: { name: string } | null
    warehouses?: { name: string } | null
    job_work_items?: {
      id: string
      is_transfer_line: boolean | null
      source_job_work_item_id: string | null
      material_type_id: string | null
      material_size_id: string | null
      item_master_id: string | null
    }[]
  }
  const jobWorkMap = new Map<string, JobWorkOrder>()
  for (const o of (jobWorkOrders.job_work_orders ?? []) as JobWorkOrder[]) jobWorkMap.set(o.id, o)

  type Transfer = {
    id: string
    reference_number: string | null
    status: string | null
    from_company?: { name: string } | null
    to_company?: { name: string } | null
    from_warehouse?: { name: string } | null
    to_warehouse?: { name: string } | null
  }
  const transferMap = new Map<string, Transfer>()
  for (const t of (transfers.transfers ?? []) as Transfer[]) transferMap.set(t.id, t)

  const itemMasterById = new Map<string, ItemMasterRow>()
  // 52 (material_type, size) pairs map to more than one item_master, so the
  // fallback keeps the alphabetically-first code and records the collision.
  const itemMasterByMaterial = new Map<string, ItemMasterRow>()
  const ambiguousMaterialKeys = new Set<string>()
  for (const im of (itemMasters.item_master ?? []) as ItemMasterRow[]) {
    itemMasterById.set(im.id, im)
    const key = `${im.material_type_id}|${im.material_size_id ?? ''}`
    if (itemMasterByMaterial.has(key)) ambiguousMaterialKeys.add(key)
    else itemMasterByMaterial.set(key, im)
  }

  const userNameById = new Map<string, string>()
  for (const u of (users.user_profiles ?? []) as { id: string; full_name: string | null }[]) {
    if (u.full_name) userNameById.set(u.id, u.full_name)
  }

  // ── Row assembly ──────────────────────────────────────────────────────

  const extraExceptions: ReconciliationFlag[] = []
  const details: DetailRow[] = []

  for (const row of rows) {
    const meta = ENTRY_TYPE_META[row.entry_type as EntryType]
    const line = row.purchase_line_id ? lineMap.get(row.purchase_line_id) : undefined

    // Item identity: prefer the item_master_id the source document recorded,
    // fall back to the ledger's own material keys.
    const materialKey = `${row.material_type_id}|${row.material_size_id ?? ''}`
    let item: ItemMasterRow | undefined
    if (line?.item_master_id) item = itemMasterById.get(line.item_master_id)
    if (!item) {
      const bucket = findDispatchBucket(
        row.reference_id,
        row.material_type_id,
        row.material_size_id,
        row.purchase_line_id
      )
      if (bucket?.itemMasterId) item = itemMasterById.get(bucket.itemMasterId)
    }
    if (!item) item = itemMasterByMaterial.get(materialKey)

    const itemCode = item?.item_code ?? row.material_types?.code ?? '—'
    const itemDescription =
      item?.item_name ?? line?.item_name ?? row.material_types?.description ?? ''
    const itemSize = row.material_sizes?.size_label ?? row.size_label ?? ''
    const unit = item?.unit ?? row.material_types?.unit ?? 'MT'

    let documentNumber = row.reference_number ?? ''
    let status = 'Active'
    let href: string | null = null
    const parties: PartyNames = {}
    let financials: SourceFinancials | null = null

    switch (meta?.party) {
      case 'supplier': {
        if (line) {
          documentNumber = line.purchase_bills?.bill_number ?? documentNumber
          status = normalizeStatus(line.purchase_bills?.status)
          parties.supplierName = line.purchase_bills?.suppliers?.name ?? null
          if (line.purchase_bills?.id) href = `/bills/${line.purchase_bills.id}`
          // The ledger posts received_quantity (migration 105), which can
          // differ from the invoiced quantity — compare against what the
          // ledger actually moved so a genuine variance is what gets flagged.
          const invoiced = num(line.quantity) ?? 0
          const received = num(line.received_quantity)
          financials = {
            sourceQuantity: received ?? invoiced,
            rate: num(line.rate),
            basicAmount: num(line.taxable_value) ?? num(line.amount),
            cgstRate: num(line.cgst_rate),
            sgstRate: num(line.sgst_rate),
            cgstAmount: num(line.cgst_amount),
            sgstAmount: num(line.sgst_amount),
            totalWithTax: num(line.total_with_tax),
          }
        }
        break
      }
      case 'customer': {
        const order = row.reference_id ? dispatchOrderMap.get(row.reference_id) : undefined
        if (order) {
          documentNumber = order.invoice_number ?? order.sale_ref_id ?? documentNumber
          status = normalizeStatus(order.status)
          parties.customerName = order.customers?.name ?? null
          href = `/dispatch/${order.id}`
          if (order.is_vendor_direct) parties.source = 'Vendor (direct sale)'
        }
        const bucket = findDispatchBucket(
          row.reference_id,
          row.material_type_id,
          row.material_size_id,
          row.purchase_line_id
        )
        if (bucket) {
          financials = {
            sourceQuantity: bucket.sourceQuantity,
            rate: bucket.rate,
            basicAmount: bucket.basicAmount,
            cgstRate: bucket.cgstRate,
            sgstRate: bucket.sgstRate,
            cgstAmount: bucket.cgstAmount,
            sgstAmount: bucket.sgstAmount,
            totalWithTax: bucket.totalWithTax,
          }
          if (bucket.lineCount > 1) {
            extraExceptions.push({
              ledgerId: row.id,
              documentNumber,
              entryType: row.entry_type,
              entryDate: row.entry_date,
              itemCode,
              itemSize,
              issue: 'Multiple source lines merged',
              detail:
                `${bucket.lineCount} dispatch lines on this invoice share the same item and size; ` +
                'their quantities and amounts are summed into this single ledger row rather than ' +
                'repeated per line. Rate shown is the blended rate.',
            })
          }
        }
        break
      }
      case 'jobworker': {
        const order = row.reference_id ? jobWorkMap.get(row.reference_id) : undefined
        if (order) {
          documentNumber = order.reference_number ?? documentNumber
          status = normalizeStatus(order.status)
          parties.jobWorkerName = order.suppliers?.name ?? null
          href = `/jobwork/${order.id}`
          if (row.entry_type === 'JOB_WORK_TRANSFER_IN') {
            parties.destination = order.suppliers?.name ?? null
          } else if (row.entry_type === 'JOB_WORK_TRANSFER_OUT') {
            parties.source = order.suppliers?.name ?? null
          }
        }
        // Job work carries no price of its own — value it at the billed
        // rate of the purchase line the material came from, never at an
        // invented sale value.
        if (line) {
          financials = {
            sourceQuantity: 0, // no comparable source quantity: valuation only
            rate: num(line.rate),
            basicAmount: null,
            cgstRate: null,
            sgstRate: null,
            cgstAmount: null,
            sgstAmount: null,
            totalWithTax: null,
            valuationOnly: true,
          }
        }
        break
      }
      case 'internal': {
        const transfer = row.reference_id ? transferMap.get(row.reference_id) : undefined
        if (transfer) {
          documentNumber = transfer.reference_number ?? documentNumber
          status = normalizeStatus(transfer.status)
          href = `/transfers/${transfer.id}`
          parties.source = [transfer.from_company?.name, transfer.from_warehouse?.name]
            .filter(Boolean)
            .join(' / ')
          parties.destination = [transfer.to_company?.name, transfer.to_warehouse?.name]
            .filter(Boolean)
            .join(' / ')
        }
        if (line) {
          financials = {
            sourceQuantity: 0,
            rate: num(line.rate),
            basicAmount: null,
            cgstRate: null,
            sgstRate: null,
            cgstAmount: null,
            sgstAmount: null,
            totalWithTax: null,
            valuationOnly: true,
          }
        }
        break
      }
      default:
        break
    }

    if (ambiguousMaterialKeys.has(materialKey) && !line?.item_master_id) {
      extraExceptions.push({
        ledgerId: row.id,
        documentNumber,
        entryType: row.entry_type,
        entryDate: row.entry_date,
        itemCode,
        itemSize,
        issue: 'Item code inferred',
        detail:
          'This ledger row has no purchase line, and more than one item code shares its ' +
          `material type and size. Showing ${itemCode} (first by code) — verify against the source document.`,
      })
    }

    const ctx: RowContext = {
      companyName: row.companies?.name ?? '',
      warehouseName: row.warehouses?.name ?? '',
      itemCode,
      itemDescription,
      itemSize,
      unit,
      documentNumber,
      status,
      createdByName: row.created_by ? userNameById.get(row.created_by) ?? '' : '',
      financials,
      parties,
      href,
    }

    details.push(buildDetailRow(row, ctx))
  }

  // ── Post-enrichment party filters ─────────────────────────────────────
  // Applied here, not in SQL: these names live on the source document, and
  // filtering them server-side would require the ledger-to-document join
  // this report deliberately avoids.
  const filtered = details.filter((d) => {
    if (filters.supplierIds.length && !filters.supplierIds.includes(d.supplierName)) return false
    if (filters.customerIds.length && !filters.customerIds.includes(d.customerName)) return false
    if (filters.jobWorkerIds.length && !filters.jobWorkerIds.includes(d.jobWorkerName)) return false
    if (!filters.includeCancelled && d.status === 'Cancelled') return false
    return true
  })

  const report = buildReport(filtered)
  report.exceptions.push(
    ...extraExceptions.filter((e) => filtered.some((d) => d.ledgerId === e.ledgerId))
  )

  // ── Opening / closing stock ───────────────────────────────────────────
  // Item identity for a balance row comes from the same item_master lookup
  // the detail rows use, so the two always name an item the same way.
  const stockPositions: StockPosition[] = []
  for (const [key, agg] of rawPositions) {
    const [materialTypeId, sizeIdRaw] = key.split('|')
    const materialSizeId = sizeIdRaw || null
    const item = itemMasterByMaterial.get(`${materialTypeId}|${sizeIdRaw}`)
    // Prefer a label already resolved on a detail row for this item.
    const sample = details.find(
      (d) => d.itemKey.startsWith(`${materialTypeId}|`) && d.sizeKey === (materialSizeId ?? '')
    )
    const closing = roundQty(agg.opening + agg.periodInward - agg.periodOutward)
    // Skip items with no opening balance, no movement and no closing balance:
    // they carry no information and would bury the rows that do. An item whose
    // inward and outward cancel out is NOT skipped — that is real activity.
    if (
      Math.abs(agg.opening) < QTY_EPSILON &&
      Math.abs(agg.periodInward) < QTY_EPSILON &&
      Math.abs(agg.periodOutward) < QTY_EPSILON &&
      Math.abs(closing) < QTY_EPSILON
    ) {
      continue
    }
    stockPositions.push({
      materialTypeId,
      materialSizeId,
      itemCode: sample?.itemCode ?? item?.item_code ?? '—',
      itemDescription: sample?.itemDescription ?? item?.item_name ?? '',
      itemSize: sample?.itemSize ?? item?.size_label ?? '',
      unit: sample?.unit ?? item?.unit ?? 'MT',
      opening: roundQty(agg.opening),
      periodInward: roundQty(agg.periodInward),
      periodOutward: roundQty(agg.periodOutward),
      closing,
    })
  }
  stockPositions.sort(
    (a, b) => a.itemCode.localeCompare(b.itemCode) || a.itemSize.localeCompare(b.itemSize)
  )

  const stockTotals = stockPositions.reduce(
    (t, p) => ({
      opening: t.opening + p.opening,
      periodInward: t.periodInward + p.periodInward,
      periodOutward: t.periodOutward + p.periodOutward,
      closing: t.closing + p.closing,
    }),
    { opening: 0, periodInward: 0, periodOutward: 0, closing: 0 }
  )

  return {
    report,
    matchedCount,
    truncated: matchedCount > rows.length,
    integrityProblems: verifyTotals(report),
    stockPositions,
    stockTotals: {
      opening: roundQty(stockTotals.opening),
      periodInward: roundQty(stockTotals.periodInward),
      periodOutward: roundQty(stockTotals.periodOutward),
      closing: roundQty(stockTotals.closing),
    },
    stockScopeBroaderThanList:
      filters.entryTypes.length > 0 ||
      filters.supplierIds.length > 0 ||
      filters.customerIds.length > 0 ||
      filters.jobWorkerIds.length > 0 ||
      filters.documentNumber.trim() !== '' ||
      !filters.includeCancelled,
  }
}
