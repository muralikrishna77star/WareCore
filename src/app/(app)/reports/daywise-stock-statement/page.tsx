export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  MOVEMENTS_REPORT_QUERY,
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

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

// entry_type direction + display, mirrored from the Stock Statement's
// in/out classification (supabase/migrations/001_initial_schema.sql) — the
// ledger doesn't reliably sign every type the same way (e.g. ADJUSTMENT_OUT),
// so direction is looked up by type rather than trusted from raw quantity sign.
const entryTypeConfig: Record<string, { label: string; color: string; isIn: boolean }> = {
  PURCHASE_IN:         { label: 'Purchase In',      color: 'bg-green-100 text-green-800', isIn: true },
  PURCHASE_CANCEL:      { label: 'Purchase Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: false },
  TRANSFER_IN:          { label: 'Transfer In',      color: 'bg-blue-100 text-blue-800',   isIn: true },
  TRANSFER_OUT:         { label: 'Transfer Out',     color: 'bg-orange-100 text-orange-800', isIn: false },
  SALE_OUT:             { label: 'Dispatch',         color: 'bg-red-100 text-red-800',     isIn: false },
  SALE_CANCEL:          { label: 'Dispatch Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUT:         { label: 'Job Work Out',     color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_RETURN_IN:   { label: 'Job Work Return',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  VENDOR_RETURN_IN:     { label: 'Vendor Return',    color: 'bg-teal-100 text-teal-800',   isIn: true },
  ADJUSTMENT_IN:        { label: 'Adjustment In',    color: 'bg-gray-100 text-gray-800',   isIn: true },
  ADJUSTMENT_OUT:       { label: 'Adjustment Out',   color: 'bg-gray-100 text-gray-800',   isIn: false },
}

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

  const conditions: Record<string, unknown>[] = [
    { entry_date: { _gte: fromDate } },
    { entry_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (selectedItem) {
    conditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      conditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  } else {
    if (params.material_type) conditions.push({ material_type_id: { _eq: params.material_type } })
    if (params.size) conditions.push({ material_size_id: { _eq: params.size } })
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
      conditions.push({ reference_id: { _in: refIds } })
    }
  }

  const result = noResults
    ? { stock_ledger: [] }
    : await hasuraQuery(MOVEMENTS_REPORT_QUERY, { where: { _and: conditions } })

  // Query already orders by entry_date asc, created_at asc — grouping below
  // preserves that order within and across days.
  const movements: any[] = result.stock_ledger ?? []

  const movementRateMap = await fetchPurchaseLineRateMap(movements.map((m: any) => m.purchase_line_id))

  const dayMap = new Map<string, DayGroup>()
  for (const m of movements) {
    const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800', isIn: Number(m.quantity) >= 0 }
    const qty = Math.abs(Number(m.quantity))
    const rate = m.purchase_line_id ? movementRateMap.get(m.purchase_line_id) ?? null : null
    const value = rate != null ? qty * rate * (cfg.isIn ? 1 : -1) : null
    const material = m.material_types?.description ?? '?'
    const size = m.material_sizes?.size_label ?? m.size_label ?? ''
    const itemName = size ? `${material} — ${size}` : material

    const day = dayMap.get(m.entry_date) ?? {
      date: m.entry_date,
      count: 0,
      totalIn: 0,
      totalOut: 0,
      net: 0,
      value: 0,
      transactions: [] as Transaction[],
    }
    day.count += 1
    if (cfg.isIn) day.totalIn += qty
    else day.totalOut += qty
    day.net = day.totalIn - day.totalOut
    day.value += value ?? 0
    day.transactions.push({
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
      value,
      reference: m.reference_number ?? '',
    })
    dayMap.set(m.entry_date, day)
  }

  const groups: DayGroup[] = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  const totals = {
    entries: movements.length,
    totalIn: groups.reduce((s, g) => s + g.totalIn, 0),
    totalOut: groups.reduce((s, g) => s + g.totalOut, 0),
    value: groups.reduce((s, g) => s + g.value, 0),
  }

  const exportRows = groups.flatMap((day) => [
    {
      'Date': formatDate(day.date),
      'Type': '',
      'Item Name': '',
      'Company': '',
      'Warehouse': '',
      'Qty': '',
      'Rate': '',
      'Value (₹)': '',
      'Reference': '',
      'Row': `Day Summary — ${day.count} txn(s)`,
      'In': day.totalIn,
      'Out': day.totalOut,
      'Net': day.net,
    },
    ...day.transactions.map((t) => ({
      'Date': formatDate(day.date),
      'Type': t.typeLabel,
      'Item Name': t.itemName,
      'Company': t.company,
      'Warehouse': t.warehouse,
      'Qty': t.isIn ? t.qty : -t.qty,
      'Rate': t.rate ?? '',
      'Value (₹)': t.value ?? '',
      'Reference': t.reference,
      'Row': '',
      'In': '',
      'Out': '',
      'Net': '',
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

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-gray-50 p-4">
          <p className="text-xs text-gray-500">Days with Activity</p>
          <p className="text-xl font-bold text-gray-800">{groups.length}</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total In</p>
          <p className="text-xl font-bold text-green-700">+{totals.totalIn.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Total Out</p>
          <p className="text-xl font-bold text-red-700">-{totals.totalOut.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-teal-50 p-4">
          <p className="text-xs text-gray-500">Net Value</p>
          <p className={`text-xl font-bold ${totals.value < 0 ? 'text-red-700' : 'text-teal-800'}`}>{fmtC(totals.value)}</p>
        </div>
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
