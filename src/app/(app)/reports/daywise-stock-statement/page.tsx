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
  PURCHASE_BILL_IDS_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
} from '@/lib/hasura/queries'
import { fetchPurchaseLineRateMap } from '@/lib/purchaseLineRates'
import { PrintButton } from '@/components/PrintButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import DaywiseStockStatementTable, { type DayGroup, type Transaction } from './DaywiseStockStatementTable'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

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

// Entry types that move stock to/from a vendor under job work — used to
// derive the running "at Vendor" balance alongside the warehouse balance.
// Same list as the Item Stock Ledger report's VENDOR_MOVEMENT_TYPES.
const VENDOR_MOVEMENT_TYPES = ['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'JOB_WORK_CANCEL', 'JOB_WORK_TRANSFER_OUT', 'JOB_WORK_TRANSFER_IN']

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
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
  }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [compResult, whResult, supResult, itemResult, matTypeResult, matSizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])

  const companies: any[] = compResult.companies ?? []
  const allWarehouses: any[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w: any) => w.company_id === params.company)
    : allWarehouses
  const suppliers: any[] = supResult.suppliers ?? []
  const materialTypes: any[] = matTypeResult.material_types ?? []
  const allSizes: any[] = matSizeResult.material_sizes ?? []
  const sizes = params.material_type
    ? allSizes.filter((s: any) => !s.material_type_id || s.material_type_id === params.material_type)
    : allSizes

  const itemRows: any[] = itemResult.item_master ?? []
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
      ...(billIdsResult.purchase_bills ?? []).map((b: any) => b.id),
      ...(jobOrderIdsResult.job_work_orders ?? []).map((o: any) => o.id),
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
  const movements: any[] = result.stock_ledger ?? []
  const openingWarehouseBalance = Number(openingWhResult.stock_ledger_aggregate?.aggregate?.sum?.quantity ?? 0)
  // Vendor balance rises when warehouse-side quantity falls (JOB_WORK_OUT is
  // negative), so it's accumulated as the negation — same convention as the
  // Item Stock Ledger report's vendorOpeningBalance.
  const openingVendorBalance = -Number(openingVendorResult.stock_ledger_aggregate?.aggregate?.sum?.quantity ?? 0)

  const movementRateMap = await fetchPurchaseLineRateMap(movements.map((m: any) => m.purchase_line_id))

  // Bucket movements by day first (preserving within-day order), then walk
  // the days in order maintaining running Warehouse/Vendor balances — so
  // each day's Opening is the prior day's Closing.
  const byDay = new Map<string, any[]>()
  for (const m of movements) {
    const list = byDay.get(m.entry_date) ?? []
    list.push(m)
    byDay.set(m.entry_date, list)
  }
  const sortedDates = Array.from(byDay.keys()).sort()

  let warehouseRunning = openingWarehouseBalance
  let vendorRunning = openingVendorBalance
  const groups: DayGroup[] = sortedDates.map((date) => {
    const dayMovements = byDay.get(date)!
    const openingWarehouse = warehouseRunning
    const openingVendor = vendorRunning
    let purchasesRaw = 0
    let salesRaw = 0
    let transferIn = 0
    let transferOutRaw = 0
    let jobWorkOutRaw = 0
    let jobReturns = 0
    let value = 0
    const transactions: Transaction[] = dayMovements.map((m) => {
      const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800', isIn: Number(m.quantity) >= 0 }
      const rawQty = Number(m.quantity)
      const qty = Math.abs(rawQty)
      const rate = m.purchase_line_id ? movementRateMap.get(m.purchase_line_id) ?? null : null
      const txnValue = rate != null ? qty * rate * (cfg.isIn ? 1 : -1) : null
      const material = m.material_types?.description ?? '?'
      const size = m.material_sizes?.size_label ?? m.size_label ?? ''
      const itemName = size ? `${material} — ${size}` : material

      warehouseRunning += rawQty
      if (VENDOR_MOVEMENT_TYPES.includes(m.entry_type)) vendorRunning -= rawQty
      if (m.entry_type === 'PURCHASE_IN' || m.entry_type === 'PURCHASE_CANCEL') purchasesRaw += rawQty
      if (m.entry_type === 'SALE_OUT' || m.entry_type === 'SALE_CANCEL') salesRaw += rawQty
      if (m.entry_type === 'TRANSFER_IN') transferIn += rawQty
      if (m.entry_type === 'TRANSFER_OUT') transferOutRaw += rawQty
      if (m.entry_type === 'JOB_WORK_OUT') jobWorkOutRaw += rawQty
      if (m.entry_type === 'JOB_WORK_RETURN_IN' || m.entry_type === 'VENDOR_RETURN_IN') jobReturns += rawQty
      value += txnValue ?? 0

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
      }
    })

    return {
      date,
      count: dayMovements.length,
      openingWarehouse,
      openingVendor,
      purchases: purchasesRaw,
      sales: -salesRaw,
      transferIn,
      transferOut: -transferOutRaw,
      jobWorkOut: -jobWorkOutRaw,
      jobReturns,
      closingWarehouse: warehouseRunning,
      closingVendor: vendorRunning,
      value,
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
    closingWarehouse: warehouseRunning,
    closingVendor: vendorRunning,
    value: groups.reduce((s, g) => s + g.value, 0),
  }

  const exportRows = groups.flatMap((day) => [
    {
      'Date': formatDate(day.date),
      'Row': `Day Summary — ${day.count} txn(s)`,
      'Opening (Warehouse)': fmtQ(day.openingWarehouse),
      'Opening (Vendor)': fmtQ(day.openingVendor),
      'Purchases': fmtQ(day.purchases),
      'Sales': fmtQ(day.sales),
      'Transfer In': fmtQ(day.transferIn),
      'Transfer Out': fmtQ(day.transferOut),
      'Job Work Out': fmtQ(day.jobWorkOut),
      'Job Returns': fmtQ(day.jobReturns),
      'Closing (Warehouse)': fmtQ(day.closingWarehouse),
      'Closing (Vendor)': fmtQ(day.closingVendor),
      'Value (₹)': day.value,
      'Type': '', 'Item Name': '', 'Company': '', 'Warehouse': '', 'Qty': '', 'Rate': '', 'Reference': '',
    },
    ...day.transactions.map((t) => ({
      'Date': formatDate(day.date),
      'Row': '',
      'Opening (Warehouse)': '', 'Opening (Vendor)': '', 'Purchases': '', 'Sales': '', 'Transfer In': '', 'Transfer Out': '', 'Job Work Out': '', 'Job Returns': '',
      'Closing (Warehouse)': '', 'Closing (Vendor)': '',
      'Value (₹)': t.value ?? '',
      'Type': t.typeLabel,
      'Item Name': t.itemName,
      'Company': t.company,
      'Warehouse': t.warehouse,
      'Qty': t.isIn ? t.qty : -t.qty,
      'Rate': t.rate ?? '',
      'Reference': t.reference,
    })),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daywise Stock Statement</h1>
          <p className="text-sm text-gray-500 mt-1">Day-by-day summary with every transaction listed underneath</p>
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <ExportExcelButton rows={exportRows} filename={`Daywise_Stock_Statement_${fromDate}_to_${toDate}`} sheetName="Daywise Stock Statement" />
          )}
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Daywise Stock Statement</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select name="warehouse" defaultValue={params.warehouse || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Material Type</label>
            <select name="material_type" defaultValue={params.material_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Material Types</option>
              {materialTypes.map((mt: any) => (
                <option key={mt.id} value={mt.id}>{mt.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
            <select name="size" defaultValue={params.size || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
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
            <select name="vendor" defaultValue={params.vendor || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Suppliers</option>
              {suppliers.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
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
