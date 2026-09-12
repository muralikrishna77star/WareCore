export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  MOVEMENTS_REPORT_QUERY,
  STOCK_LEDGER_OPENING_BALANCE_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_MATERIAL_TYPES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
  STOCK_LEDGER_DATE_BOUNDS_QUERY,
  PURCHASE_BILLS_SUPPLIER_LOOKUP_QUERY,
  JOB_WORK_ORDERS_VENDOR_NAME_LOOKUP_QUERY,
  DISPATCH_ORDERS_CUSTOMER_LOOKUP_QUERY,
  PURCHASE_BILL_IDS_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
  JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY,
} from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import { MonthYearFilter } from '@/components/MonthYearFilter'
import { resolveStatementPeriod, yearOptionsFrom } from '@/lib/dateRange'
import DaywiseStockStatementTable, { type DayGroup, type Transaction } from './DaywiseStockStatementTable'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { VENDOR_MOVEMENT_TYPES, isVendorMovementRow, vendorOutputOrderKey } from '@/lib/stockLedger'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'

// Stock Movement classification for the Transaction Details export — same
// four buckets used elsewhere in the app (INWARD/OUTWARD/TRANSFER/ADJUSTMENT).
const STOCK_MOVEMENT_BY_TYPE: Record<string, 'INWARD' | 'OUTWARD' | 'TRANSFER' | 'ADJUSTMENT'> = {
  PURCHASE_IN: 'INWARD',
  PURCHASE_CANCEL: 'OUTWARD',
  SALE_OUT: 'OUTWARD',
  SALE_CANCEL: 'INWARD',
  JOB_WORK_OUT: 'OUTWARD',
  JOB_WORK_RETURN_IN: 'INWARD',
  JOB_WORK_CANCEL: 'INWARD',
  JOB_WORK_OUTPUT_IN: 'INWARD',
  JOB_WORK_TRANSFER_OUT: 'TRANSFER',
  JOB_WORK_TRANSFER_IN: 'TRANSFER',
  VENDOR_RETURN_IN: 'INWARD',
  TRANSFER_IN: 'TRANSFER',
  TRANSFER_OUT: 'TRANSFER',
  ADJUSTMENT_IN: 'ADJUSTMENT',
  ADJUSTMENT_OUT: 'ADJUSTMENT',
}

const fmtQ = (n: number) => n.toFixed(3)
const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

// entry_type direction + display, mirrored from the Stock Statement's
// in/out classification (supabase/migrations/001_initial_schema.sql) — the
// ledger doesn't reliably sign every type the same way (e.g. ADJUSTMENT_OUT),
// so direction is looked up by type rather than trusted from raw quantity sign.
const entryTypeConfig: Record<string, { label: string; color: string; isIn: boolean }> = {
  PURCHASE_IN:          { label: 'Purchase In',      color: 'bg-green-100 text-green-800', isIn: true },
  PURCHASE_CANCEL:       { label: 'Purchase Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: false },
  TRANSFER_IN:           { label: 'Transfer In',      color: 'bg-blue-100 text-blue-800',   isIn: true },
  TRANSFER_OUT:          { label: 'Transfer Out',     color: 'bg-orange-100 text-orange-800', isIn: false },
  SALE_OUT:              { label: 'Dispatch',         color: 'bg-red-100 text-red-800',     isIn: false },
  SALE_CANCEL:           { label: 'Dispatch Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUT:          { label: 'Job Work Out',     color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_RETURN_IN:    { label: 'Job Work Return',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_CANCEL:       { label: 'Job Work Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUTPUT_IN:    { label: 'Job Work Output',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_TRANSFER_OUT: { label: 'JW Transfer Out',  color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_TRANSFER_IN:  { label: 'JW Transfer In',   color: 'bg-purple-100 text-purple-800', isIn: true },
  VENDOR_RETURN_IN:      { label: 'Vendor Return',    color: 'bg-teal-100 text-teal-800',   isIn: true },
  ADJUSTMENT_IN:         { label: 'Adjustment In',    color: 'bg-gray-100 text-gray-800',   isIn: true },
  ADJUSTMENT_OUT:        { label: 'Adjustment Out',   color: 'bg-gray-100 text-gray-800',   isIn: false },
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

interface Company {
  id: string
  name: string
  code?: string | null
}

interface Warehouse {
  id: string
  name: string
  company_id: string
}

interface Supplier {
  id: string
  name: string
}

interface MaterialType {
  id: string
  description: string
}

interface MaterialSize {
  id: string
  material_type_id: string | null
  size_label: string
}

interface ItemMasterRow {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  material_sizes?: { size_label: string } | null
}

interface StockLedgerMovement {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number: string | null
  reference_type: string | null
  reference_id: string | null
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  size_label: string | null
  notes: string | null
  material_type_id: string | null
  material_size_id: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
}

export default async function DaywiseStockStatementPage({
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
    month?: string
    year?: string
  }>
}) {
  const params = await searchParams

  // Month/Year populates From/To; editing either afterwards makes the period
  // a custom range. A selected CURRENT month stops at today rather than at
  // month end. Everything downstream — opening balance, daily movements,
  // warehouse and vendor running balances, closing balance and the Excel
  // export — already derives from these two dates, so resolving them here is
  // the whole of the change.
  const period = resolveStatementPeriod({
    from: params.from,
    to: params.to,
    month: params.month,
    year: params.year,
  })
  const { from: fromDate, to: toDate } = period

  const [compResult, whResult, supResult, itemResult, matTypeResult, matSizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])
  const ledgerBoundsResult = await hasuraQuery(STOCK_LEDGER_DATE_BOUNDS_QUERY)
  const ledgerBounds = ledgerBoundsResult.stock_ledger_aggregate?.aggregate
  // The resolved year must be selectable even when the ledger holds no data
  // for it — the default period is the CURRENT month, which is typically
  // later than the newest ledger entry.
  const yearOptions = yearOptionsFrom(ledgerBounds?.min?.entry_date, ledgerBounds?.max?.entry_date, [
    period.year,
    new Date().getFullYear(),
  ])

  const companies = (compResult.companies ?? []) as Company[]
  const allWarehouses = (whResult.warehouses ?? []) as Warehouse[]
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses
  const suppliers = (supResult.suppliers ?? []) as Supplier[]
  const materialTypes = (matTypeResult.material_types ?? []) as MaterialType[]
  const allSizes = (matSizeResult.material_sizes ?? []) as MaterialSize[]
  const sizes = params.material_type
    ? allSizes.filter((s) => !s.material_type_id || s.material_type_id === params.material_type)
    : allSizes

  const itemRows = (itemResult.item_master ?? []) as ItemMasterRow[]
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

  // Scope filters shared by the opening-balance lookups and the in-range
  // movements query — kept separate from the date-range conditions so the
  // same scope can be reused with an "entry_date < fromDate" cutoff.
  const scopeConditions: Record<string, unknown>[] = []
  if (params.company) scopeConditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) scopeConditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (selectedItem) {
    scopeConditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      scopeConditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  } else {
    if (params.material_type) scopeConditions.push({ material_type_id: { _eq: params.material_type } })
    if (params.size) scopeConditions.push({ material_size_id: { _eq: params.size } })
  }

  // Vendor isn't stored on stock_ledger directly — resolve it to the set of
  // purchase bill / job work order IDs it appears on, same approach as the
  // Movements Report and Stock Statement pages.
  let noResults = false
  if (params.vendor) {
    const [billIdsResult, jobOrderIdsResult] = await Promise.all([
      hasuraQuery(PURCHASE_BILL_IDS_QUERY, { where: { supplier_id: { _eq: params.vendor } } }),
      hasuraQuery(JOB_WORK_ORDER_IDS_QUERY, { where: { vendor_id: { _eq: params.vendor } } }),
    ])
    const refIds = [
      ...(billIdsResult.purchase_bills ?? []).map((b: { id: string }) => b.id),
      ...(jobOrderIdsResult.job_work_orders ?? []).map((o: { id: string }) => o.id),
    ]
    if (refIds.length === 0) {
      noResults = true
    } else {
      scopeConditions.push({ reference_id: { _in: refIds } })
    }
  }

  const periodWhere = {
    _and: [...scopeConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
  }
  const openingWarehouseWhere = { _and: [...scopeConditions, { entry_date: { _lt: fromDate } }] }
  const openingVendorWhere = {
    _and: [...scopeConditions, { entry_date: { _lt: fromDate } }, { entry_type: { _in: VENDOR_MOVEMENT_TYPES } }],
  }

  const [result, openingWhResult, openingVendorResult] = noResults
    ? [{ stock_ledger: [] }, { stock_ledger_aggregate: { aggregate: { sum: { quantity: 0 } } } }, { stock_ledger_aggregate: { aggregate: { sum: { quantity: 0 } } } }]
    : await Promise.all([
        hasuraQuery(MOVEMENTS_REPORT_QUERY, { where: periodWhere }),
        hasuraQuery(STOCK_LEDGER_OPENING_BALANCE_QUERY, { where: openingWarehouseWhere }),
        hasuraQuery(STOCK_LEDGER_OPENING_BALANCE_QUERY, { where: openingVendorWhere }),
      ])

  // Query already orders by entry_date asc, created_at asc — grouping below
  // preserves that order within and across days.
  const movements = (result.stock_ledger ?? []) as StockLedgerMovement[]

  // A JOB_WORK_OUTPUT_IN row only counts as a vendor movement when its
  // order's Output Materials line matches one of that order's own INPUT
  // lines' material — no real conversion happened, so it's really the
  // vendor-return leg. Single authoritative check shared with Item Stock
  // Ledger / Stock Statement (isVendorMovementRow, src/lib/stockLedger.ts).
  // Note: openingVendorBalance below is NOT corrected by this — it's a raw
  // DB aggregate over VENDOR_MOVEMENT_TYPES only, same limitation this
  // figure already had when no single item is selected (summing across
  // materials/units isn't meaningful there either).
  const outputOrderIds = Array.from(
    new Set(movements.filter((m) => m.entry_type === 'JOB_WORK_OUTPUT_IN' && m.reference_id).map((m) => m.reference_id as string))
  )
  const sameMaterialOutputKeys = new Set<string>()
  if (outputOrderIds.length > 0) {
    const matchingInputResult = await hasuraQuery(JOB_WORK_ORDERS_INPUT_MATERIALS_QUERY, { ids: outputOrderIds })
    const rows: { job_work_order_id: string; material_type_id: string; material_size_id: string | null }[] =
      matchingInputResult.job_work_items ?? []
    for (const r of rows) sameMaterialOutputKeys.add(vendorOutputOrderKey(r.job_work_order_id, r.material_type_id, r.material_size_id))
  }
  const isVendorMovementMovement = (m: StockLedgerMovement) =>
    isVendorMovementRow(m.entry_type, m.reference_id, m.material_type_id, m.material_size_id, sameMaterialOutputKeys)

  const openingWarehouseBalance = Number(openingWhResult.stock_ledger_aggregate?.aggregate?.sum?.quantity ?? 0)
  // Vendor balance rises when warehouse-side quantity falls (JOB_WORK_OUT is
  // negative), so it's accumulated as the negation — same convention as the
  // Item Stock Ledger report's vendorOpeningBalance.
  const openingVendorBalance = -Number(openingVendorResult.stock_ledger_aggregate?.aggregate?.sum?.quantity ?? 0)

  const movementRateMap = await fetchPurchaseLineRateMap(movements.map((m) => m.purchase_line_id))

  // Counterparty for each movement, resolved in three batched lookups keyed
  // by stock_ledger.reference_id. Attached from Maps rather than joined, so a
  // movement can never be duplicated by its own party lookup. Exactly one
  // role applies per row — purchases have a supplier, sales a customer, job
  // work a vendor — so they share a single column.
  const uniqueIds = (type: string) =>
    Array.from(new Set(movements.filter((m) => m.reference_type === type && m.reference_id).map((m) => m.reference_id as string)))
  const billIds = uniqueIds('purchase_bill')
  const dispatchIds = uniqueIds('dispatch')
  const jobIds = uniqueIds('job_work')

  const [billPartyRes, dispatchPartyRes, jobPartyRes] = await Promise.all([
    billIds.length ? hasuraQuery(PURCHASE_BILLS_SUPPLIER_LOOKUP_QUERY, { ids: billIds }) : Promise.resolve({ purchase_bills: [] }),
    dispatchIds.length ? hasuraQuery(DISPATCH_ORDERS_CUSTOMER_LOOKUP_QUERY, { ids: dispatchIds }) : Promise.resolve({ dispatch_orders: [] }),
    jobIds.length ? hasuraQuery(JOB_WORK_ORDERS_VENDOR_NAME_LOOKUP_QUERY, { ids: jobIds }) : Promise.resolve({ job_work_orders: [] }),
  ])

  const partyByRef = new Map<string, { name: string; role: string }>()
  for (const b of (billPartyRes.purchase_bills ?? []) as { id: string; suppliers?: { name: string } | null }[]) {
    if (b.suppliers?.name) partyByRef.set(b.id, { name: b.suppliers.name, role: 'Supplier' })
  }
  for (const d of (dispatchPartyRes.dispatch_orders ?? []) as { id: string; customers?: { name: string } | null }[]) {
    if (d.customers?.name) partyByRef.set(d.id, { name: d.customers.name, role: 'Customer' })
  }
  for (const j of (jobPartyRes.job_work_orders ?? []) as { id: string; suppliers?: { name: string } | null }[]) {
    if (j.suppliers?.name) partyByRef.set(j.id, { name: j.suppliers.name, role: 'Vendor' })
  }
  // Transfers have no external counterparty — left blank rather than guessed.
  const partyFor = (referenceId: string | null | undefined) =>
    (referenceId && partyByRef.get(referenceId)) || { name: '', role: '' }

  // Bucket movements by day first (preserving within-day order), then walk
  // the days in order maintaining running Warehouse/Vendor balances — so
  // each day's Opening is the prior day's Closing.
  const byDay = new Map<string, StockLedgerMovement[]>()
  for (const m of movements) {
    const list = byDay.get(m.entry_date) ?? []
    list.push(m)
    byDay.set(m.entry_date, list)
  }
  const sortedDates = Array.from(byDay.keys()).sort()

  // Built alongside `groups` purely for the Transaction Details export sheet
  // — every transaction with its post-transaction running balance, using the
  // exact same warehouseRunning/vendorRunning sequence the on-screen
  // per-day Opening/Closing figures are derived from, so the export always
  // agrees with the screen.
  const transactionDetailRows: Record<string, unknown>[] = []

  // Plain accumulators for a one-shot server-side computation — held in
  // objects (rather than reassigned `let`s) so the running totals are
  // mutated via property writes, not variable reassignment, inside the
  // doubly-nested map (days, then transactions within a day).
  const runningBalance = { warehouse: openingWarehouseBalance, vendor: openingVendorBalance }
  const groups: DayGroup[] = sortedDates.map((date) => {
    const dayMovements = byDay.get(date)!
    const openingWarehouse = runningBalance.warehouse
    const openingVendor = runningBalance.vendor
    const dayTotals = {
      purchasesRaw: 0,
      salesRaw: 0,
      transferIn: 0,
      transferOutRaw: 0,
      jobWorkOutRaw: 0,
      jobReturns: 0,
      value: 0,
    }
    const transactions: Transaction[] = dayMovements.map((m) => {
      const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800', isIn: Number(m.quantity) >= 0 }
      const rawQty = Number(m.quantity)
      const qty = Math.abs(rawQty)
      const rate = m.purchase_line_id ? movementRateMap.get(m.purchase_line_id) ?? null : null
      const txnValue = rate != null ? qty * rate * (cfg.isIn ? 1 : -1) : null
      const material = m.material_types?.description ?? '?'
      const size = m.material_sizes?.size_label ?? m.size_label ?? ''
      const itemName = size ? `${material} — ${size}` : material

      runningBalance.warehouse += rawQty
      if (isVendorMovementMovement(m)) runningBalance.vendor -= rawQty
      if (m.entry_type === 'PURCHASE_IN' || m.entry_type === 'PURCHASE_CANCEL') dayTotals.purchasesRaw += rawQty
      if (m.entry_type === 'SALE_OUT' || m.entry_type === 'SALE_CANCEL') dayTotals.salesRaw += rawQty
      if (m.entry_type === 'TRANSFER_IN') dayTotals.transferIn += rawQty
      if (m.entry_type === 'TRANSFER_OUT') dayTotals.transferOutRaw += rawQty
      if (m.entry_type === 'JOB_WORK_OUT') dayTotals.jobWorkOutRaw += rawQty
      if (m.entry_type === 'JOB_WORK_RETURN_IN' || m.entry_type === 'VENDOR_RETURN_IN') dayTotals.jobReturns += rawQty
      dayTotals.value += txnValue ?? 0

      const isVendorMovement = isVendorMovementMovement(m)
      transactionDetailRows.push({
        date,
        typeLabel: cfg.label,
        stockMovement: STOCK_MOVEMENT_BY_TYPE[m.entry_type] ?? (cfg.isIn ? 'INWARD' : 'OUTWARD'),
        documentNumber: m.reference_number ?? '',
        company: m.companies?.name ?? '',
        warehouse: m.warehouses?.name ?? '',
        itemName,
        unit: m.material_types?.unit ?? 'tons',
        inwardQty: rawQty > 0 ? rawQty : null,
        outwardQty: rawQty < 0 ? Math.abs(rawQty) : null,
        warehouseChange: rawQty,
        vendorChange: isVendorMovement ? -rawQty : 0,
        warehouseBalance: runningBalance.warehouse,
        vendorBalance: runningBalance.vendor,
        rate: rate ?? null,
        value: txnValue ?? null,
        partyLabel: (() => {
          const pa = partyFor(m.reference_id)
          return pa.name ? `${pa.name}${pa.role ? ` (${pa.role})` : ''}` : ''
        })(),
        remarks: m.notes ?? '',
      })

      return {
        id: m.id,
        typeLabel: cfg.label,
        typeColor: cfg.color,
        itemName,
        unit: m.material_types?.unit ?? 'tons',
        company: m.companies?.name ?? '',
        warehouse: m.warehouses?.name ?? '',
        qty,
        isIn: cfg.isIn,
        rate,
        value: txnValue,
        reference: m.reference_number ?? '',
        party: partyFor(m.reference_id).name,
        partyRole: partyFor(m.reference_id).role,
      }
    })

    return {
      date,
      count: dayMovements.length,
      openingWarehouse,
      openingVendor,
      purchases: dayTotals.purchasesRaw,
      sales: -dayTotals.salesRaw,
      transferIn: dayTotals.transferIn,
      transferOut: -dayTotals.transferOutRaw,
      jobWorkOut: -dayTotals.jobWorkOutRaw,
      jobReturns: dayTotals.jobReturns,
      closingWarehouse: runningBalance.warehouse,
      closingVendor: runningBalance.vendor,
      value: dayTotals.value,
      transactions,
    }
  })

  const totals = {
    entries: movements.length,
    openingWarehouse: openingWarehouseBalance,
    openingVendor: openingVendorBalance,
    purchases: groups.reduce((s, g) => s + g.purchases, 0),
    sales: groups.reduce((s, g) => s + g.sales, 0),
    transferIn: groups.reduce((s, g) => s + g.transferIn, 0),
    transferOut: groups.reduce((s, g) => s + g.transferOut, 0),
    jobWorkOut: groups.reduce((s, g) => s + g.jobWorkOut, 0),
    jobReturns: groups.reduce((s, g) => s + g.jobReturns, 0),
    closingWarehouse: runningBalance.warehouse,
    closingVendor: runningBalance.vendor,
    value: groups.reduce((s, g) => s + g.value, 0),
  }

  // Professional 2-sheet export: Daywise Summary (one row per day, same
  // figures as the on-screen compact summary bar) + Transaction Details
  // (every transaction, chronological, with a continuous running balance —
  // built alongside the day loop above from the exact same running totals).
  const exportMeta = {
    companyName: companies.find((c) => c.id === params.company)?.name || 'All Companies',
    fromDate,
    toDate,
    filterLine: [
      `Period: ${period.label}${period.mode === 'month' ? ' (selected month)' : ' (custom range)'}`,
      `Effective: ${fromDate} to ${toDate}`,
      `Warehouse: ${warehouses.find((w) => w.id === params.warehouse)?.name || 'All Warehouses'}`,
      `Item: ${selectedItem?.label || 'All Items'}`,
      `Supplier: ${suppliers.find((s) => s.id === params.vendor)?.name || 'All Suppliers'}`,
    ].join('   |   '),
    generatedBy: '',
  }
  const summarySheet: ProfessionalSheetSpec = {
    sheetName: 'Daywise Summary',
    title: `Daywise Stock Statement — Summary — ${period.label}`,
    emptyMessage: 'No stock movements found for the selected period.',
    columns: [
      { header: 'Date', key: 'date', width: 14, align: 'center', isDate: true },
      { header: 'Transactions', key: 'count', width: 12, align: 'center' },
      { header: 'Opening (Warehouse)', key: 'openingWarehouse', width: 18, align: 'right', numFmt: QTY_FMT },
      { header: 'Opening (Vendor)', key: 'openingVendor', width: 16, align: 'right', numFmt: QTY_FMT },
      { header: 'Purchases', key: 'purchases', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Sales', key: 'sales', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Transfer In', key: 'transferIn', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Transfer Out', key: 'transferOut', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Job Work Out', key: 'jobWorkOut', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Job Returns', key: 'jobReturns', width: 14, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Closing (Warehouse)', key: 'closingWarehouse', width: 18, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Closing (Vendor)', key: 'closingVendor', width: 16, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Value (₹)', key: 'value', width: 16, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
    ],
    rows: groups.map((day) => ({
      date: day.date,
      count: day.count,
      openingWarehouse: day.openingWarehouse,
      openingVendor: day.openingVendor,
      purchases: day.purchases,
      sales: day.sales,
      transferIn: day.transferIn,
      transferOut: day.transferOut,
      jobWorkOut: day.jobWorkOut,
      jobReturns: day.jobReturns,
      closingWarehouse: day.closingWarehouse,
      closingVendor: day.closingVendor,
      value: day.value,
    })),
  }
  const transactionDetailsSheet: ProfessionalSheetSpec = {
    sheetName: 'Transaction Details',
    title: `Daywise Stock Statement — Transaction Details — ${period.label}`,
    emptyMessage: 'No stock movements found for the selected period.',
    columns: [
      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
      { header: 'Transaction Type', key: 'typeLabel', width: 20, align: 'left' },
      { header: 'Stock Movement', key: 'stockMovement', width: 14, align: 'center' },
      { header: 'Document Number', key: 'documentNumber', width: 18, align: 'left' },
      { header: 'Company', key: 'company', width: 16, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Item Name', key: 'itemName', width: 28, align: 'left' },
      { header: 'Unit', key: 'unit', width: 10, align: 'center' },
      { header: 'Inward Quantity', key: 'inwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Outward Quantity', key: 'outwardQty', width: 16, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Warehouse Quantity Change', key: 'warehouseChange', width: 22, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Vendor Quantity Change', key: 'vendorChange', width: 20, align: 'right', numFmt: QTY_FMT, totalsFn: 'sum' },
      { header: 'Warehouse Running Balance', key: 'warehouseBalance', width: 22, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Vendor Running Balance', key: 'vendorBalance', width: 20, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Transaction Value (₹)', key: 'value', width: 18, align: 'right', numFmt: MONEY_FMT, totalsFn: 'sum' },
      { header: 'Customer / Vendor / Supplier', key: 'partyLabel', width: 30, align: 'left' },
      { header: 'Remarks', key: 'remarks', width: 22, align: 'left' },
    ],
    rows: transactionDetailRows.map((row, idx) => ({ sno: idx + 1, ...row })),
  }

  // Combined sheet: one row per day, with that day's own transactions nested
  // directly beneath it at outline level 1, so the whole statement is
  // expandable/collapsible inside a single sheet using Excel's native group
  // controls. Built from `groups` — the same running balances the screen and
  // the two separate sheets use — so all three always agree.
  const combinedRows: Record<string, unknown>[] = []
  const combinedOutline: number[] = []
  for (const g of groups) {
    combinedRows.push({
      date: g.date,
      kind: 'DAY TOTAL',
      itemName: `${g.count} transaction${g.count === 1 ? '' : 's'}`,
      openingWarehouse: g.openingWarehouse,
      openingVendor: g.openingVendor,
      inward: g.purchases + g.transferIn + g.jobReturns,
      outward: Math.abs(g.sales) + Math.abs(g.transferOut) + Math.abs(g.jobWorkOut),
      closingWarehouse: g.closingWarehouse,
      closingVendor: g.closingVendor,
      value: g.value,
    })
    combinedOutline.push(0)

    for (const t of g.transactions) {
      combinedRows.push({
        date: g.date,
        kind: t.typeLabel,
        itemName: t.itemName,
        company: t.company,
        warehouse: t.warehouse,
        partyLabel: t.party ? `${t.party}${t.partyRole ? ` (${t.partyRole})` : ''}` : '',
        reference: t.reference,
        inward: t.isIn ? Math.abs(t.qty) : null,
        outward: t.isIn ? null : Math.abs(t.qty),
        rate: t.rate,
        value: t.value,
      })
      combinedOutline.push(1)
    }
  }

  const combinedSheet: ProfessionalSheetSpec = {
    sheetName: 'Daywise + Transactions',
    title: `Daywise Stock Statement — Day Totals with Transactions — ${period.label}`,
    emptyMessage: 'No stock movements found for the selected period.',
    columns: [
      { header: 'Date', key: 'date', width: 14, align: 'center', isDate: true },
      { header: 'Day / Transaction Type', key: 'kind', width: 22, align: 'left' },
      { header: 'Item Name', key: 'itemName', width: 30, align: 'left' },
      { header: 'Company', key: 'company', width: 18, align: 'left' },
      { header: 'Warehouse', key: 'warehouse', width: 16, align: 'left' },
      { header: 'Customer / Vendor / Supplier', key: 'partyLabel', width: 30, align: 'left' },
      { header: 'Reference', key: 'reference', width: 20, align: 'left' },
      { header: 'Opening (Warehouse)', key: 'openingWarehouse', width: 18, align: 'right', numFmt: QTY_FMT },
      { header: 'Opening (Vendor)', key: 'openingVendor', width: 16, align: 'right', numFmt: QTY_FMT },
      { header: 'Inward Qty', key: 'inward', width: 14, align: 'right', numFmt: QTY_FMT },
      { header: 'Outward Qty', key: 'outward', width: 14, align: 'right', numFmt: QTY_FMT },
      { header: 'Closing (Warehouse)', key: 'closingWarehouse', width: 18, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Closing (Vendor)', key: 'closingVendor', width: 16, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
      { header: 'Value (₹)', key: 'value', width: 16, align: 'right', numFmt: MONEY_FMT },
    ],
    rows: combinedRows,
    rowOutlineLevels: combinedOutline,
    // Day rows keep the summary styling so they stand out from their detail.
    highlightRowIndexes: combinedOutline.flatMap((lvl, i) => (lvl === 0 ? [i] : [])),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Daywise Stock Statement
            <span className="ml-2 text-lg font-semibold text-gray-600">— {period.label}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Day-by-day summary with every transaction listed underneath
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                period.mode === 'month'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {period.mode === 'month' ? 'Selected month' : 'Custom date range'}
            </span>
            <span className="ml-2 text-xs text-gray-400">
              {fromDate} to {toDate}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <ProfessionalExportButton
              meta={exportMeta}
              sheets={[combinedSheet, summarySheet, transactionDetailsSheet]}
              filenameBase="Daywise_Stock_Statement"
              successMessage="Daywise Stock Statement exported successfully."
              errorMessage="Unable to export the Daywise Stock Statement. Please try again."
            />
          )}
          <PrintButton />
          <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ArrowLeft className="h-4 w-4" /> Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Daywise Stock Statement — {period.label}</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month / Year</label>
            <div className="flex gap-2">
              <MonthYearFilter month={period.month} year={period.year} yearOptions={yearOptions} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select name="warehouse" defaultValue={params.warehouse || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Material Type</label>
            <select name="material_type" defaultValue={params.material_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Material Types</option>
              {materialTypes.map((mt) => (
                <option key={mt.id} value={mt.id}>{mt.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
            <select name="size" defaultValue={params.size || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Sizes</option>
              {sizes.map((s) => (
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
            <select name="vendor" defaultValue={params.vendor || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply Filters</button>
          <Link
            href="/reports/daywise-stock-statement"
            className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset
          </Link>
        </div>
      </form>

      {/* Summary — one compact row instead of a card dashboard */}
      <div className="flex items-center gap-x-3 gap-y-1 overflow-x-auto whitespace-nowrap rounded-lg border bg-gray-50 px-3 py-1.5 text-[11px]">
        <span className="text-gray-400">Days <b className="text-gray-800 font-semibold">{groups.length}</b></span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-400">Opening <b className="text-blue-800 font-semibold">{fmtQ(totals.openingWarehouse)}</b> Wh / <b className="text-purple-700 font-semibold">{fmtQ(totals.openingVendor)}</b> Vd</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-400">Purchases <b className="text-green-700 font-semibold">+{fmtQ(totals.purchases)}</b></span>
        <span className="text-gray-400">Sales <b className="text-red-600 font-semibold">-{fmtQ(totals.sales)}</b></span>
        <span className="text-gray-400">Transfer In <b className="text-blue-700 font-semibold">+{fmtQ(totals.transferIn)}</b></span>
        <span className="text-gray-400">Transfer Out <b className="text-orange-700 font-semibold">-{fmtQ(totals.transferOut)}</b></span>
        <span className="text-gray-400">JW Out <b className="text-purple-700 font-semibold">-{fmtQ(totals.jobWorkOut)}</b></span>
        <span className="text-gray-400">JW Return <b className="text-teal-700 font-semibold">+{fmtQ(totals.jobReturns)}</b></span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-400">Closing <b className="text-gray-900 font-semibold">{fmtQ(totals.closingWarehouse)}</b> Wh / <b className="text-purple-800 font-semibold">{fmtQ(totals.closingVendor)}</b> Vd</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-400">Value <b className={`font-semibold ${totals.value < 0 ? 'text-red-700' : 'text-teal-800'}`}>{fmtC(totals.value)}</b></span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{totals.entries} entr{totals.entries !== 1 ? 'ies' : 'y'}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {groups.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No stock movements found for the selected period.</p>
          ) : (
            <DaywiseStockStatementTable groups={groups} />
          )}
        </div>
      </div>
    </div>
  )
}
