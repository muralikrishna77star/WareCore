export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { verifySession } from '@/lib/auth/session'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  STOCK_STATEMENT_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  PURCHASE_BILL_IDS_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
  JOB_WORK_ORDERS_VENDOR_LOOKUP_QUERY,
  DISPATCH_ORDERS_CUSTOMER_LOOKUP_QUERY,
  TRANSFERS_WAREHOUSE_LOOKUP_QUERY,
  AVERAGE_PURCHASE_RATES_QUERY,
  USER_PROFILES_QUERY,
} from '@/lib/hasura/queries'
import { VENDOR_MOVEMENT_TYPES } from '@/lib/stockLedger'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import { StockStatementExportButton } from './StockStatementExportButton'
import type { StockStatementExportItem, TransactionDetailRow } from '@/lib/exportStockStatementExcel'
import { type StatementRow } from './StockStatementTable'
import StockStatementTabs from './StockStatementTabs'
import Link from 'next/link'

type LedgerRow = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  created_at: string
  material_type_id: string
  material_size_id?: string | null
  size_label?: string | null
  material_types: { description: string; unit: string }
  material_sizes?: { size_label: string } | null
  warehouse_id?: string
  warehouses?: { name: string } | null
  company_id?: string
  companies?: { name: string } | null
  reference_type?: string | null
  reference_id?: string | null
  reference_number?: string | null
  notes?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  created_by?: string | null
}

// entry_type → human label + INWARD/OUTWARD/TRANSFER/ADJUSTMENT classification
// for the Transaction Details extract. Job Work Out/Return are classified by
// their warehouse-side effect (matches the worked example in the product
// spec), not as TRANSFER — TRANSFER is reserved for warehouse-to-warehouse
// TRANSFER_IN/OUT. Anything not listed falls back to sign-based IN/OUT so no
// type is ever left unclassified.
const ENTRY_TYPE_INFO: Record<string, { label: string; movement: 'INWARD' | 'OUTWARD' | 'TRANSFER' | 'ADJUSTMENT' }> = {
  PURCHASE_IN: { label: 'Purchase Receipt', movement: 'INWARD' },
  PURCHASE_CANCEL: { label: 'Purchase Return', movement: 'OUTWARD' },
  TRANSFER_IN: { label: 'Stock Transfer In', movement: 'TRANSFER' },
  TRANSFER_OUT: { label: 'Stock Transfer Out', movement: 'TRANSFER' },
  SALE_OUT: { label: 'Sales Dispatch', movement: 'OUTWARD' },
  SALE_CANCEL: { label: 'Sales Return', movement: 'INWARD' },
  JOB_WORK_OUT: { label: 'Job Work Out', movement: 'OUTWARD' },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return', movement: 'INWARD' },
  VENDOR_RETURN_IN: { label: 'Vendor Return', movement: 'INWARD' },
  ADJUSTMENT_IN: { label: 'Warehouse Inward Adjustment', movement: 'ADJUSTMENT' },
  ADJUSTMENT_OUT: { label: 'Warehouse Outward Adjustment', movement: 'ADJUSTMENT' },
  JOB_WORK_CANCEL: { label: 'Job Work Cancelled', movement: 'ADJUSTMENT' },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output Received', movement: 'INWARD' },
  JOB_WORK_TRANSFER_OUT: { label: 'Job Work Transfer Out (Vendor to Vendor)', movement: 'TRANSFER' },
  JOB_WORK_TRANSFER_IN: { label: 'Job Work Transfer In (Vendor to Vendor)', movement: 'TRANSFER' },
}

const SOURCE_MODULE_LABEL: Record<string, string> = {
  purchase_bill: 'Purchase Bills',
  dispatch: 'Dispatch Orders',
  job_work: 'Job Work Orders',
  transfer: 'Transfers',
}

type StockItem = {
  material: string
  unit: string
  size: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  openingWarehouse: number
  openingVendor: number
  purchase_in: number
  transfer_in: number
  transfer_out: number
  dispatch_out: number
  jw_out: number
  jw_return: number
  other_in: number
  other_out: number
  closingWarehouse: number
  closingVendor: number
  rate: number
  warehouseBreakdown: Map<string, number>
  vendorBreakdown: Map<string, number>
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

// Named warehouse-column buckets, mirrored from the Daywise Stock
// Statement's entry_type classification. Anything not listed here still
// affects the true closing balance (accumulated unconditionally below) —
// it just falls into the catch-all Other In/Out columns instead of a
// named one, so no transaction type is ever silently dropped.
const WAREHOUSE_BUCKET: Record<string, 'purchase_in' | 'transfer_in' | 'transfer_out' | 'dispatch_out' | 'jw_out' | 'jw_return'> = {
  PURCHASE_IN: 'purchase_in',
  PURCHASE_CANCEL: 'purchase_in',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  SALE_OUT: 'dispatch_out',
  SALE_CANCEL: 'dispatch_out',
  JOB_WORK_OUT: 'jw_out',
  JOB_WORK_RETURN_IN: 'jw_return',
  VENDOR_RETURN_IN: 'jw_return',
}

export default async function StockStatementPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    warehouse?: string
    material_type?: string
    size?: string
    item?: string
    vendor?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams

  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('wc_session')?.value
  const session = sessionToken ? verifySession(sessionToken) : null

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [compResult, whResult, itemResult, matTypeResult, matSizeResult, supResult, userResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(USER_PROFILES_QUERY),
  ])
  const userNameById = new Map<string, string>(
    ((userResult.user_profiles ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name])
  )

  const companies: { id: string; name: string }[] = compResult.companies ?? []
  const allWarehouses: { id: string; name: string; company_id: string }[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses
  const suppliers: any[] = supResult.suppliers ?? []
  const materialTypes: any[] = matTypeResult.material_types ?? []
  const allSizes: any[] = matSizeResult.material_sizes ?? []
  const sizes = params.material_type
    ? allSizes.filter((s: any) => !s.material_type_id || s.material_type_id === params.material_type)
    : allSizes

  // material_type_id + material_size_id → item_master.id, so each row's
  // summary cells can link to that item's detailed Item Ledger entries.
  const itemRows = (itemResult.item_master ?? []) as { id: string; item_code: string; item_name: string; material_type_id: string; material_size_id: string | null; size_label?: string | null; material_sizes?: { size_label: string } | null }[]
  const itemIdByMaterial = new Map<string, string>()
  const itemCodeByMaterial = new Map<string, string>()
  for (const it of itemRows) {
    itemIdByMaterial.set(`${it.material_type_id}|${it.material_size_id ?? ''}`, it.id)
    itemCodeByMaterial.set(`${it.material_type_id}|${it.material_size_id ?? ''}`, it.item_code)
  }
  const itemOptions: ItemOption[] = itemRows.map((i) => {
    const size = i.material_sizes?.size_label || i.size_label
    return {
      id: i.id,
      label: `${i.item_code} — ${i.item_name}${size ? ` (${size})` : ''}`,
      search: `${i.item_code} ${i.item_name} ${size ?? ''}`.toLowerCase(),
      material_type_id: i.material_type_id,
      material_size_id: i.material_size_id,
    }
  })
  const selectedItem = params.item ? itemOptions.find((i) => i.id === params.item) : undefined

  // Build dynamic where clauses — never pass null to _eq
  const baseConditions: Record<string, unknown>[] = []
  if (params.company) baseConditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) baseConditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (selectedItem) {
    baseConditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      baseConditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  } else {
    if (params.material_type) baseConditions.push({ material_type_id: { _eq: params.material_type } })
    if (params.size) baseConditions.push({ material_size_id: { _eq: params.size } })
  }

  // Vendor isn't stored on stock_ledger directly — resolve it to the set of
  // purchase bill / job work order IDs it appears on, same approach as the
  // Stock Movements ledger and Movements Report pages.
  let noResults = false
  if (params.vendor) {
    const [billIdsResult, jobOrderIdsResult] = await Promise.all([
      hasuraQuery(PURCHASE_BILL_IDS_QUERY, { where: { supplier_id: { _eq: params.vendor } } }),
      hasuraQuery(JOB_WORK_ORDER_IDS_QUERY, { where: { vendor_id: { _eq: params.vendor } } }),
    ])
    const refIds = [
      ...(billIdsResult.purchase_bills ?? []).map((b: any) => b.id),
      ...(jobOrderIdsResult.job_work_orders ?? []).map((o: any) => o.id),
    ]
    if (refIds.length === 0) {
      noResults = true
    } else {
      baseConditions.push({ reference_id: { _in: refIds } })
    }
  }

  // Opening = balance immediately before From Date. Period = only
  // transactions dated within [From Date, To Date] inclusive — both are
  // needed to compute Warehouse/Vendor stock "as on To Date"; there is no
  // separate "live" query, so the report is fully reproducible for any past
  // date range regardless of what has happened since.
  const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
  const periodWhere = {
    _and: [...baseConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
  }

  // Rate for valuation: quantity-weighted average of every billed rate for
  // that material_type + size, up to the To Date — mirrors the Item
  // Ledger's purchase-line rate lookup, but resolved by material/size
  // instead of by ledger row since Stock Statement rows are aggregated
  // across many transactions.
  const rateConditions: Record<string, unknown>[] = [
    { rate: { _is_null: false } },
    { purchase_bill: { status: { _eq: 'active' }, bill_date: { _lte: toDate } } },
  ]
  if (params.company) rateConditions.push({ purchase_bill: { company_id: { _eq: params.company } } })
  if (params.warehouse) rateConditions.push({ purchase_bill: { warehouse_id: { _eq: params.warehouse } } })
  if (selectedItem) {
    rateConditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      rateConditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  } else {
    if (params.material_type) rateConditions.push({ material_type_id: { _eq: params.material_type } })
    if (params.size) rateConditions.push({ material_size_id: { _eq: params.size } })
  }
  const rateWhere = { _and: rateConditions }

  const [result, rateResult] = noResults
    ? [{ opening: [], period: [] }, { purchase_bill_items: [] }]
    : await Promise.all([
        hasuraQuery(STOCK_STATEMENT_QUERY, { opening_where: openingWhere, period_where: periodWhere }),
        hasuraQuery(AVERAGE_PURCHASE_RATES_QUERY, { where: rateWhere }),
      ])

  const openingRows: LedgerRow[] = result.opening ?? []
  const periodRows: LedgerRow[] = result.period ?? []

  // Vendor names for the "Stock by Vendor" breakdown — job-work movements
  // reference a job_work_orders.id, which carries the vendor. Batched once
  // per distinct order id (same technique as the Item Stock Ledger report),
  // covering both opening and period rows since either can contribute to
  // the vendor balance as on To Date.
  const jobWorkOrderIds = Array.from(
    new Set(
      [...openingRows, ...periodRows]
        .filter((r) => VENDOR_MOVEMENT_TYPES.includes(r.entry_type) && r.reference_type === 'job_work' && r.reference_id)
        .map((r) => r.reference_id as string)
    )
  )
  let vendorNameByJobWorkOrderId = new Map<string, string>()
  if (jobWorkOrderIds.length > 0) {
    const vendorLookupResult = await hasuraQuery(JOB_WORK_ORDERS_VENDOR_LOOKUP_QUERY, { ids: jobWorkOrderIds })
    const rows: { id: string; suppliers?: { name: string } | null }[] = vendorLookupResult.job_work_orders ?? []
    vendorNameByJobWorkOrderId = new Map(rows.map((r) => [r.id, r.suppliers?.name ?? 'Unknown Vendor']))
  }

  // Customer names for the Transaction Details extract — SALE_OUT/SALE_CANCEL
  // reference a dispatch_orders.id, which carries the customer.
  const dispatchIds = Array.from(
    new Set(
      [...openingRows, ...periodRows]
        .filter((r) => r.reference_type === 'dispatch' && r.reference_id)
        .map((r) => r.reference_id as string)
    )
  )
  let customerNameByDispatchId = new Map<string, string>()
  if (dispatchIds.length > 0) {
    const custResult = await hasuraQuery(DISPATCH_ORDERS_CUSTOMER_LOOKUP_QUERY, { ids: dispatchIds })
    const rows: { id: string; customers?: { name: string } | null }[] = custResult.dispatch_orders ?? []
    customerNameByDispatchId = new Map(rows.map((r) => [r.id, r.customers?.name ?? '']))
  }

  // Source/Destination Warehouse for the Transaction Details extract —
  // TRANSFER_IN/OUT reference a transfers.id, which carries both warehouses.
  const transferIds = Array.from(
    new Set(
      [...openingRows, ...periodRows]
        .filter((r) => r.reference_type === 'transfer' && r.reference_id)
        .map((r) => r.reference_id as string)
    )
  )
  let transferWarehousesById = new Map<string, { from: string; to: string }>()
  if (transferIds.length > 0) {
    const transferResult = await hasuraQuery(TRANSFERS_WAREHOUSE_LOOKUP_QUERY, { ids: transferIds })
    const rows: { id: string; warehouses_from?: { name: string } | null; warehouses_to?: { name: string } | null }[] = transferResult.transfers ?? []
    transferWarehousesById = new Map(rows.map((r) => [r.id, { from: r.warehouses_from?.name ?? '', to: r.warehouses_to?.name ?? '' }]))
  }

  // Per-transaction rate (the actual billed rate for that specific purchase
  // line, not the item's weighted average) for the Transaction Details
  // extract — same helper used by Movements Report / Daywise Stock Statement.
  const transactionRateMap = await fetchPurchaseLineRateMap(periodRows.map((r) => r.purchase_line_id))

  // Weighted average = total billed amount / total quantity across every
  // matching purchase line, per material_type_id|material_size_id key.
  const rateTotals = new Map<string, { qty: number; amt: number }>()
  for (const row of (rateResult.purchase_bill_items ?? []) as {
    material_type_id: string
    material_size_id: string | null
    quantity: number | string
    rate: number | string
    amount: number | string | null
  }[]) {
    const key = `${row.material_type_id}|${row.material_size_id ?? ''}`
    const qty = Number(row.quantity)
    const amt = row.amount != null ? Number(row.amount) : qty * Number(row.rate)
    const running = rateTotals.get(key) ?? { qty: 0, amt: 0 }
    running.qty += qty
    running.amt += amt
    rateTotals.set(key, running)
  }
  const rateMap = new Map<string, number>()
  for (const [key, { qty, amt }] of rateTotals) {
    if (qty > 0) rateMap.set(key, Math.round((amt / qty) * 100) / 100)
  }

  // Aggregate by material + size
  const items: Record<string, StockItem> = {}

  const getKey = (row: LedgerRow) => {
    const name = row.material_types?.description ?? '?'
    const size = row.material_sizes?.size_label ?? row.size_label ?? '—'
    return `${name}||${size}`
  }

  const ensureItem = (row: LedgerRow): StockItem => {
    const key = getKey(row)
    if (!items[key]) {
      const material = row.material_types?.description ?? '?'
      const size = row.material_sizes?.size_label ?? row.size_label ?? ''
      items[key] = {
        material,
        unit: row.material_types?.unit ?? 'tons',
        size,
        item_name: size ? `${material} — ${size}` : material,
        material_type_id: row.material_type_id,
        material_size_id: row.material_size_id ?? null,
        openingWarehouse: 0,
        openingVendor: 0,
        purchase_in: 0,
        transfer_in: 0,
        transfer_out: 0,
        dispatch_out: 0,
        jw_out: 0,
        jw_return: 0,
        other_in: 0,
        other_out: 0,
        closingWarehouse: 0,
        closingVendor: 0,
        rate: 0,
        warehouseBreakdown: new Map(),
        vendorBreakdown: new Map(),
      }
    }
    return items[key]
  }

  // Vendor name attribution for a job-work-referenced row, keyed the same
  // way item-ledger resolves it — only meaningful for VENDOR_MOVEMENT_TYPES.
  const vendorNameFor = (row: LedgerRow): string =>
    row.reference_type === 'job_work' && row.reference_id
      ? vendorNameByJobWorkOrderId.get(row.reference_id) ?? 'Unknown Vendor'
      : 'Unknown Vendor'

  // Vendor-side delta for a VENDOR_MOVEMENT_TYPES row. JOB_WORK_OUT/RETURN_IN/
  // CANCEL are posted with the *warehouse's* sign (negative when material
  // leaves the warehouse for a vendor), so the vendor side is the inverse
  // (-qty). JOB_WORK_TRANSFER_OUT/IN are different: both legs share the
  // source order's warehouse_id purely so they net to zero on warehouse
  // stock, but each is posted on the vendor whose stock is actually moving
  // — TRANSFER_OUT (negative) on the losing vendor, TRANSFER_IN (positive)
  // on the gaining vendor — so the vendor side is qty as-is, not inverted.
  const vendorDeltaFor = (row: LedgerRow, qty: number): number =>
    row.entry_type === 'JOB_WORK_TRANSFER_OUT' || row.entry_type === 'JOB_WORK_TRANSFER_IN' ? qty : -qty

  // Opening balance: unconditional sum of everything before From Date (true
  // running balance regardless of type), plus the same for the Vendor side
  // restricted to job-work movement types — same convention as the Item
  // Stock Ledger and Daywise Stock Statement reports.
  for (const row of openingRows) {
    const item = ensureItem(row)
    const qty = Number(row.quantity)
    item.openingWarehouse += qty
    const whName = row.warehouses?.name ?? 'Unknown Warehouse'
    item.warehouseBreakdown.set(whName, (item.warehouseBreakdown.get(whName) ?? 0) + qty)
    if (VENDOR_MOVEMENT_TYPES.includes(row.entry_type)) {
      const vendorDelta = vendorDeltaFor(row, qty)
      item.openingVendor += vendorDelta
      const vendorName = vendorNameFor(row)
      item.vendorBreakdown.set(vendorName, (item.vendorBreakdown.get(vendorName) ?? 0) + vendorDelta)
    }
  }

  // Period movements: bucketed into named columns for display, but the
  // closing balance itself is accumulated unconditionally below so no
  // transaction type — however it's classified for display — can ever be
  // silently dropped from the total.
  for (const row of periodRows) {
    const item = ensureItem(row)
    const qty = Number(row.quantity)

    const bucket = WAREHOUSE_BUCKET[row.entry_type]
    if (bucket === 'purchase_in') item.purchase_in += qty
    else if (bucket === 'transfer_in') item.transfer_in += qty
    else if (bucket === 'transfer_out') item.transfer_out += Math.abs(qty)
    else if (bucket === 'dispatch_out') {
      if (row.entry_type === 'SALE_OUT') item.dispatch_out += Math.abs(qty)
      else item.dispatch_out -= qty // SALE_CANCEL: qty is positive — nets out the original SALE_OUT
    } else if (bucket === 'jw_out') item.jw_out += Math.abs(qty)
    else if (bucket === 'jw_return') item.jw_return += qty
    else if (row.entry_type === 'ADJUSTMENT_IN' || qty > 0) item.other_in += qty
    else item.other_out += Math.abs(qty)

    item.closingWarehouse += qty
    const whName = row.warehouses?.name ?? 'Unknown Warehouse'
    item.warehouseBreakdown.set(whName, (item.warehouseBreakdown.get(whName) ?? 0) + qty)

    if (VENDOR_MOVEMENT_TYPES.includes(row.entry_type)) {
      const vendorDelta = vendorDeltaFor(row, qty)
      item.closingVendor += vendorDelta
      const vendorName = vendorNameFor(row)
      item.vendorBreakdown.set(vendorName, (item.vendorBreakdown.get(vendorName) ?? 0) + vendorDelta)
    }
  }

  // closingWarehouse/closingVendor were accumulated as deltas above — fold
  // in the opening balances now that every row has been processed.
  for (const item of Object.values(items)) {
    item.closingWarehouse += item.openingWarehouse
    item.closingVendor += item.openingVendor
  }

  const sorted = Object.values(items).sort(
    (a, b) => a.material.localeCompare(b.material) || a.size.localeCompare(b.size),
  )

  // Rate = quantity-weighted average billed rate up to the To Date for that
  // material + size; 0 (shown as —) when the item has never been purchased.
  for (const item of sorted) {
    item.rate = rateMap.get(`${item.material_type_id}|${item.material_size_id ?? ''}`) ?? 0
  }

  // Valuation = Stock at Warehouse × weighted average purchase rate.
  const itemValue = (item: StockItem) => item.closingWarehouse * item.rate
  const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

  // ── Transaction Details extract ─────────────────────────────────────────
  // Built from the exact same periodRows already used for the Summary above
  // — one OPENING BALANCE row per item, then every period transaction in
  // chronological order (the query is already sorted entry_date, created_at)
  // with a running Warehouse/Vendor balance. This is the same authoritative
  // source as the Summary, not a separate calculation, so the final running
  // balance is guaranteed to equal the Summary's Stock at Warehouse/Vendor —
  // verified explicitly below rather than assumed.
  const periodRowsByKey: Record<string, LedgerRow[]> = {}
  for (const row of periodRows) {
    const key = getKey(row)
    ;(periodRowsByKey[key] ??= []).push(row)
  }

  const transactions: TransactionDetailRow[] = []
  let allReconciled = true

  for (const item of sorted) {
    const itemKey = `${item.material_type_id}|${item.material_size_id ?? ''}`
    const displayKey = `${item.material}||${item.size || '—'}`
    const itemCode = itemCodeByMaterial.get(itemKey) ?? '—'

    transactions.push({
      isOpeningRow: true,
      itemKey,
      date: fromDate,
      typeLabel: 'OPENING BALANCE',
      stockMovement: '',
      documentNumber: '',
      companyName: '',
      warehouseName: '',
      sourceWarehouseName: '',
      destinationWarehouseName: '',
      vendorName: '',
      customerName: '',
      itemCode,
      itemName: item.item_name,
      size: item.size,
      unit: item.unit,
      inwardQty: 0,
      outwardQty: 0,
      warehouseChange: 0,
      vendorChange: 0,
      warehouseBalance: item.openingWarehouse,
      vendorBalance: item.openingVendor,
      rate: null,
      value: null,
      remarks: 'Opening balance as of the selected From Date — not a period transaction',
      status: 'Posted',
      createdBy: '',
      sourceModule: '',
      sourceRecordId: '',
      ledgerId: '',
    })

    let runningWarehouse = item.openingWarehouse
    let runningVendor = item.openingVendor

    for (const row of periodRowsByKey[displayKey] ?? []) {
      const rawQty = Number(row.quantity)
      const info = ENTRY_TYPE_INFO[row.entry_type] ?? { label: row.entry_type, movement: rawQty >= 0 ? 'INWARD' as const : 'OUTWARD' as const }
      const isVendorMovement = VENDOR_MOVEMENT_TYPES.includes(row.entry_type)
      const warehouseChange = rawQty
      const vendorChange = isVendorMovement ? vendorDeltaFor(row, rawQty) : 0
      runningWarehouse += warehouseChange
      runningVendor += vendorChange

      const isTransferOut = row.entry_type === 'TRANSFER_OUT'
      const isTransferIn = row.entry_type === 'TRANSFER_IN'
      const transferPair = row.reference_id ? transferWarehousesById.get(row.reference_id) : undefined
      const warehouseName = row.warehouses?.name ?? ''

      const rate = row.purchase_line_id ? transactionRateMap.get(row.purchase_line_id) ?? null : null

      transactions.push({
        isOpeningRow: false,
        itemKey,
        date: row.entry_date,
        typeLabel: info.label,
        stockMovement: info.movement,
        documentNumber: row.reference_number ?? '',
        companyName: row.companies?.name ?? '',
        warehouseName,
        sourceWarehouseName: isTransferOut ? warehouseName : isTransferIn ? (transferPair?.from ?? '') : '',
        destinationWarehouseName: isTransferIn ? warehouseName : isTransferOut ? (transferPair?.to ?? '') : '',
        vendorName: isVendorMovement && row.reference_type === 'job_work' && row.reference_id
          ? vendorNameByJobWorkOrderId.get(row.reference_id) ?? 'Unknown Vendor'
          : '',
        customerName: row.reference_type === 'dispatch' && row.reference_id
          ? customerNameByDispatchId.get(row.reference_id) ?? ''
          : '',
        itemCode,
        itemName: item.item_name,
        size: item.size,
        unit: item.unit,
        inwardQty: rawQty > 0 ? rawQty : 0,
        outwardQty: rawQty < 0 ? -rawQty : 0,
        warehouseChange,
        vendorChange,
        warehouseBalance: runningWarehouse,
        vendorBalance: runningVendor,
        rate,
        value: rate != null ? rawQty * rate : null,
        remarks: row.notes ?? '',
        status: 'Posted',
        createdBy: row.created_by ? userNameById.get(row.created_by) ?? 'Unknown User' : '',
        sourceModule: SOURCE_MODULE_LABEL[row.reference_type ?? ''] ?? (row.reference_type ?? ''),
        sourceRecordId: row.reference_id ?? '',
        ledgerId: row.id,
      })
    }

    // Reconciliation: the running balance walked above must land exactly on
    // the Summary's own closingWarehouse/closingVendor for this item — both
    // come from the same rows, so a mismatch would mean a real bug, not an
    // expected edge case.
    if (Math.abs(runningWarehouse - item.closingWarehouse) > 0.001) allReconciled = false
    if (Math.abs(runningVendor - item.closingVendor) > 0.001) allReconciled = false
  }

  const reconciliation = {
    reconciled: allReconciled,
    warehouseOpening: sorted.reduce((s, i) => s + i.openingWarehouse, 0),
    warehouseNetMovement: sorted.reduce((s, i) => s + (i.closingWarehouse - i.openingWarehouse), 0),
    warehouseClosing: sorted.reduce((s, i) => s + i.closingWarehouse, 0),
    vendorOpening: sorted.reduce((s, i) => s + i.openingVendor, 0),
    vendorNetMovement: sorted.reduce((s, i) => s + (i.closingVendor - i.openingVendor), 0),
    vendorClosing: sorted.reduce((s, i) => s + i.closingVendor, 0),
  }
  if (!reconciliation.reconciled) {
    console.error('[StockStatement] Reconciliation mismatch between Summary and Transaction Details', {
      fromDate, toDate, params,
    })
  }

  // Stock split by warehouse and by vendor, both "as on To Date" — dropped
  // to a sorted array (zero/near-zero entries excluded) for both the
  // expandable UI row and the Excel export beneath it.
  const breakdownArray = (map: Map<string, number>) =>
    Array.from(map.entries())
      .filter(([, qty]) => Math.abs(qty) > 0.0005)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, qty]) => ({ name, qty }))

  // Build a link to this item's Item Ledger, scoped to the same filters and
  // optionally to specific entry types (e.g. just PURCHASE_IN for that cell).
  const ledgerLink = (item: StockItem, opts: { from: string; to: string; types?: string[] }) => {
    const itemId = itemIdByMaterial.get(`${item.material_type_id}|${item.material_size_id ?? ''}`)
    if (!itemId) return null
    const qs = new URLSearchParams({ item: itemId, from: opts.from, to: opts.to })
    if (item.material_size_id) qs.set('size', item.material_size_id)
    if (params.company) qs.set('company', params.company)
    if (params.warehouse) qs.set('warehouse', params.warehouse)
    if (opts.types?.length) qs.set('types', opts.types.join(','))
    return `/reports/item-ledger?${qs.toString()}`
  }

  // Excel export data — one row per item, exactly mirroring the on-screen
  // table (same numbers, same source, no separate recalculation). See
  // StockStatementExportButton / exportStockStatementExcel.
  const exportItems: StockStatementExportItem[] = sorted.map((item) => ({
    itemCode: itemCodeByMaterial.get(`${item.material_type_id}|${item.material_size_id ?? ''}`) ?? '—',
    itemName: item.item_name,
    size: item.size,
    unit: item.unit,
    openingWarehouse: item.openingWarehouse,
    openingVendor: item.openingVendor,
    purchaseIn: item.purchase_in,
    otherIn: item.other_in,
    transferIn: item.transfer_in,
    dispatch: item.dispatch_out,
    jobWorkOut: item.jw_out,
    transferOut: item.transfer_out,
    otherOut: item.other_out,
    jwReturn: item.jw_return,
    stockAtWarehouse: item.closingWarehouse,
    stockAtVendor: item.closingVendor,
    totalAvailable: item.closingWarehouse + item.closingVendor,
    rate: item.rate,
    value: itemValue(item),
  }))

  const totals = {
    openingWarehouse: sorted.reduce((s, i) => s + i.openingWarehouse, 0),
    openingVendor:    sorted.reduce((s, i) => s + i.openingVendor, 0),
    purchase_in:      sorted.reduce((s, i) => s + i.purchase_in, 0),
    transfer_in:      sorted.reduce((s, i) => s + i.transfer_in, 0),
    jw_return:        sorted.reduce((s, i) => s + i.jw_return, 0),
    other_in:         sorted.reduce((s, i) => s + i.other_in, 0),
    transfer_out:     sorted.reduce((s, i) => s + i.transfer_out, 0),
    dispatch_out:     sorted.reduce((s, i) => s + i.dispatch_out, 0),
    jw_out:           sorted.reduce((s, i) => s + i.jw_out, 0),
    other_out:        sorted.reduce((s, i) => s + i.other_out, 0),
    warehouse:        sorted.reduce((s, i) => s + i.closingWarehouse, 0),
    vendor:           sorted.reduce((s, i) => s + i.closingVendor, 0),
    value:            sorted.reduce((s, i) => s + itemValue(i), 0),
  }
  const totalCombined = totals.warehouse + totals.vendor

  const tableRows: StatementRow[] = sorted.map((item) => ({
    key: `${item.material_type_id}|${item.material_size_id ?? ''}`,
    itemName: item.item_name,
    unit: item.unit,
    openingWarehouse: item.openingWarehouse,
    openingWarehouseHref: ledgerLink(item, { from: '2000-01-01', to: fromDate }),
    openingVendor: item.openingVendor,
    purchaseIn: item.purchase_in,
    purchaseInHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['PURCHASE_IN'] }),
    jwOut: item.jw_out,
    jwOutHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['JOB_WORK_OUT'] }),
    transferIn: item.transfer_in,
    transferInHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['TRANSFER_IN'] }),
    jwReturn: item.jw_return,
    jwReturnHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['JOB_WORK_RETURN_IN', 'VENDOR_RETURN_IN'] }),
    dispatch: item.dispatch_out,
    dispatchHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['SALE_OUT'] }),
    transferOut: item.transfer_out,
    transferOutHref: ledgerLink(item, { from: fromDate, to: toDate, types: ['TRANSFER_OUT'] }),
    otherIn: item.other_in,
    otherOut: item.other_out,
    stockAtWarehouse: item.closingWarehouse,
    stockAtWarehouseHref: ledgerLink(item, { from: '2000-01-01', to: toDate }),
    stockAtVendor: item.closingVendor,
    totalAvailable: item.closingWarehouse + item.closingVendor,
    rate: item.rate,
    value: itemValue(item),
    warehouseBreakdown: breakdownArray(item.warehouseBreakdown),
    vendorBreakdown: breakdownArray(item.vendorBreakdown),
  }))

  const selectedCompanyName = params.company ? companies.find((c) => c.id === params.company)?.name : undefined
  const selectedWarehouseName = params.warehouse ? warehouses.find((w) => w.id === params.warehouse)?.name : undefined
  const selectedVendorName = params.vendor ? suppliers.find((s: any) => s.id === params.vendor)?.name : undefined
  const exportMeta = {
    companyName: selectedCompanyName ?? 'All Companies',
    warehouseName: selectedWarehouseName ?? 'All Warehouses',
    itemLabel: selectedItem?.label ?? 'All Items',
    vendorLabel: selectedVendorName ?? 'All Vendors',
    fromDate,
    toDate,
    generatedBy: session?.fullName ?? '—',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Statement</h1>
          <p className="mt-1 text-sm text-gray-500">
            Opening stock, all movements, and closing stock by item — as on the selected To Date
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StockStatementExportButton
            items={exportItems}
            totals={totals}
            meta={exportMeta}
            transactions={transactions}
            reconciliation={reconciliation}
          />
          <Link href="/reports/stock-reconcile" className="text-sm text-orange-600 hover:underline font-medium">
            Reconcile Stock
          </Link>
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">
            ← Back to Reports
          </Link>
        </div>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select
              name="company"
              defaultValue={params.company || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select
              name="warehouse"
              defaultValue={params.warehouse || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Material Type</label>
            <select
              name="material_type"
              defaultValue={params.material_type || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Material Types</option>
              {materialTypes.map((mt: any) => (
                <option key={mt.id} value={mt.id}>{mt.description}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
            <select
              name="size"
              defaultValue={params.size || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Sizes</option>
              {sizes.map((s: any) => (
                <option key={s.id} value={s.id}>{s.size_label}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
            <ItemComboBox
              name="item"
              defaultValue={params.item || ''}
              defaultLabel={selectedItem?.label || ''}
              placeholder="Search item…"
              options={itemOptions}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
            <select
              name="vendor"
              defaultValue={params.vendor || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              name="from"
              defaultValue={fromDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              name="to"
              defaultValue={toDate}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </form>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-400 inline-block" /> Opening Stock</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-400 inline-block" /> Stock In</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> Stock Out</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-700 inline-block" /> Stock at Warehouse (as on To Date)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Stock at Vendor (as on To Date, open job work)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" /> Total Available Stock (Warehouse + Vendor)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-teal-500 inline-block" /> Avg Rate &amp; Value (weighted average purchase rate × Stock at Warehouse)</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900">
            {fromDate} &rarr; {toDate}
          </h2>
          <div className="flex items-center gap-4 flex-wrap">
            {sorted.length > 0 && (
              <span className="text-xs text-gray-400">Click a row for warehouse &amp; vendor breakdown</span>
            )}
            {sorted.length > 0 && (
              <>
                <span className="text-sm font-semibold text-gray-800">Total Warehouse: {totals.warehouse.toFixed(3)}</span>
                <span className="text-sm font-semibold text-amber-700">Total Vendor: {totals.vendor.toFixed(3)}</span>
                <span className="text-sm font-semibold text-indigo-700">Combined: {totalCombined.toFixed(3)}</span>
                <span className="text-sm font-semibold text-teal-800">Total Value: {fmtC(totals.value)}</span>
              </>
            )}
            <span className="text-sm text-gray-500">{sorted.length} item{sorted.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="overflow-auto max-h-[70vh]">
          {sorted.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-gray-500 text-sm">No stock movements found for the selected filters.</p>
              <p className="text-gray-400 text-xs mt-1">Try adjusting the date range or company filter.</p>
            </div>
          ) : (
            <StockStatementTabs
              tableRows={tableRows}
              totals={totals}
              transactions={transactions}
              reconciled={reconciliation.reconciled}
            />
          )}
        </div>
      </div>
    </div>
  )
}
