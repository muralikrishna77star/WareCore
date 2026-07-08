export const dynamic = 'force-dynamic'

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
} from '@/lib/hasura/queries'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import Link from 'next/link'

type LedgerRow = {
  entry_type?: string
  quantity: number | string
  material_type_id: string
  material_size_id?: string | null
  size_label?: string | null
  material_types: { description: string; unit: string }
  material_sizes?: { size_label: string } | null
}

type StockItem = {
  material: string
  unit: string
  size: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  opening: number
  purchase_in: number
  transfer_in: number
  transfer_out: number
  dispatch_out: number
  jw_out: number
  jw_return: number
  adjustment: number
  current_stock: number
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
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

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [compResult, whResult, itemResult, matTypeResult, matSizeResult, supResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_TYPES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
  ])

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
  for (const it of itemRows) {
    itemIdByMaterial.set(`${it.material_type_id}|${it.material_size_id ?? ''}`, it.id)
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

  const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
  const periodWhere = {
    _and: [...baseConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
  }
  // current_where: all entries up to today (no date ceiling) → gives live stock
  const currentWhere = baseConditions.length > 0 ? { _and: baseConditions } : {}

  const result = noResults
    ? { opening: [], period: [], current: [] }
    : await hasuraQuery(STOCK_STATEMENT_QUERY, { opening_where: openingWhere, period_where: periodWhere, current_where: currentWhere })

  const openingRows: LedgerRow[] = result.opening ?? []
  const periodRows: LedgerRow[] = result.period ?? []
  const currentRows: LedgerRow[] = result.current ?? []

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
        opening: 0,
        purchase_in: 0,
        transfer_in: 0,
        transfer_out: 0,
        dispatch_out: 0,
        jw_out: 0,
        jw_return: 0,
        adjustment: 0,
        current_stock: 0,
      }
    }
    return items[key]
  }

  for (const row of openingRows) {
    ensureItem(row).opening += Number(row.quantity)
  }

  for (const row of periodRows) {
    const item = ensureItem(row)
    const qty = Number(row.quantity)
    switch (row.entry_type) {
      case 'PURCHASE_IN':        item.purchase_in  += qty; break
      case 'PURCHASE_CANCEL':    item.purchase_in  += qty; break  // qty is negative — reduces purchase_in
      case 'TRANSFER_IN':        item.transfer_in  += qty; break
      case 'TRANSFER_OUT':       item.transfer_out += Math.abs(qty); break
      case 'SALE_OUT':           item.dispatch_out += Math.abs(qty); break
      case 'SALE_CANCEL':        item.dispatch_out -= qty; break  // qty is positive (reversal) — nets out the original SALE_OUT
      case 'JOB_WORK_OUT':       item.jw_out       += Math.abs(qty); break
      case 'JOB_WORK_RETURN_IN':
      case 'VENDOR_RETURN_IN':   item.jw_return    += qty; break
      case 'ADJUSTMENT_IN':      item.adjustment   += qty; break
      case 'ADJUSTMENT_OUT':     item.adjustment   -= Math.abs(qty); break
    }
  }

  // Current stock = net of ALL stock_ledger entries (no date filter)
  for (const row of currentRows) {
    // ensureItem creates the entry if it doesn't exist yet (items with no period activity)
    const item = ensureItem(row)
    // We accumulate sum then assign at end — reset first pass handled by current_stock: 0 init
    item.current_stock += Number(row.quantity)
  }

  const sorted = Object.values(items).sort(
    (a, b) => a.material.localeCompare(b.material) || a.size.localeCompare(b.size),
  )

  const closing = (item: StockItem) =>
    item.opening +
    item.purchase_in +
    item.transfer_in +
    item.jw_return +
    item.adjustment -
    item.transfer_out -
    item.dispatch_out -
    item.jw_out

  const fmtQ = (n: number) => n.toFixed(3)

  const exportRows = sorted.map((item) => ({
    'Item Name': item.item_name,
    'Unit': item.unit,
    'Opening': item.opening,
    'Purchase In': item.purchase_in,
    'Transfer In': item.transfer_in,
    'JW Return': item.jw_return,
    'Dispatch': item.dispatch_out,
    'Transfer Out': item.transfer_out,
    'Job Work Out': item.jw_out,
    'Closing': closing(item),
    'Live Stock': item.current_stock,
  }))

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

  const totals = {
    opening:       sorted.reduce((s, i) => s + i.opening, 0),
    purchase_in:   sorted.reduce((s, i) => s + i.purchase_in, 0),
    transfer_in:   sorted.reduce((s, i) => s + i.transfer_in, 0),
    jw_return:     sorted.reduce((s, i) => s + i.jw_return, 0),
    transfer_out:  sorted.reduce((s, i) => s + i.transfer_out, 0),
    dispatch_out:  sorted.reduce((s, i) => s + i.dispatch_out, 0),
    jw_out:        sorted.reduce((s, i) => s + i.jw_out, 0),
    closing:       sorted.reduce((s, i) => s + closing(i), 0),
    current_stock: sorted.reduce((s, i) => s + i.current_stock, 0),
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Statement</h1>
          <p className="mt-1 text-sm text-gray-500">
            Opening stock, all movements, and closing stock by item
          </p>
        </div>
        <div className="flex items-center gap-4">
          {sorted.length > 0 && (
            <ExportExcelButton rows={exportRows} filename={`Stock_Statement_${fromDate}_to_${toDate}`} sheetName="Stock Statement" />
          )}
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
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-700 inline-block" /> Closing Stock</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block" /> Live Stock (all-time)</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {fromDate} &rarr; {toDate}
          </h2>
          <span className="text-sm text-gray-500">{sorted.length} item{sorted.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="overflow-auto max-h-[70vh]">
          {sorted.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="text-gray-500 text-sm">No stock movements found for the selected filters.</p>
              <p className="text-gray-400 text-xs mt-1">Try adjusting the date range or company filter.</p>
            </div>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="border-b text-xs font-semibold uppercase">
                  <th className="px-4 py-3 text-left text-gray-600 bg-white">Item Name</th>
                  <th className="px-4 py-3 text-left text-gray-400 bg-white">Unit</th>
                  {/* Opening */}
                  <th className="px-4 py-3 text-right text-blue-700 bg-blue-50">Opening</th>
                  {/* IN columns */}
                  <th className="px-4 py-3 text-right text-green-700 bg-green-50">Purchase In</th>
                  <th className="px-4 py-3 text-right text-green-700 bg-green-50">Transfer In</th>
                  <th className="px-4 py-3 text-right text-green-700 bg-green-50">JW Return</th>
                  {/* OUT columns */}
                  <th className="px-4 py-3 text-right text-red-700 bg-red-50">Dispatch</th>
                  <th className="px-4 py-3 text-right text-red-700 bg-red-50">Transfer Out</th>
                  <th className="px-4 py-3 text-right text-red-700 bg-red-50">Job Work Out</th>
                  {/* Closing */}
                  <th className="px-4 py-3 text-right text-gray-800 bg-gray-100">Closing</th>
                  {/* Current / Live */}
                  <th className="px-4 py-3 text-right text-purple-700 bg-purple-50">Live Stock</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {sorted.map((item, i) => {
                  const cl = closing(item)
                  const cell = (value: number, className: string, types?: string[]) => {
                    const text = value > 0 ? fmtQ(value) : '—'
                    const href = value > 0 ? ledgerLink(item, { from: fromDate, to: toDate, types }) : null
                    return (
                      <td className={className}>
                        {href ? <Link href={href} className="hover:underline">{text}</Link> : text}
                      </td>
                    )
                  }
                  const openingHref = ledgerLink(item, { from: '2000-01-01', to: fromDate })
                  const liveHref = ledgerLink(item, { from: '2000-01-01', to: new Date().toISOString().split('T')[0] })
                  return (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.item_name}</td>
                      <td className="px-4 py-3 text-gray-400">{item.unit}</td>
                      <td className="px-4 py-3 text-right text-blue-700 bg-blue-50/40">
                        {openingHref ? <Link href={openingHref} className="hover:underline">{fmtQ(item.opening)}</Link> : fmtQ(item.opening)}
                      </td>
                      {cell(item.purchase_in, 'px-4 py-3 text-right text-green-700 bg-green-50/40', ['PURCHASE_IN'])}
                      {cell(item.transfer_in, 'px-4 py-3 text-right text-green-700 bg-green-50/40', ['TRANSFER_IN'])}
                      {cell(item.jw_return, 'px-4 py-3 text-right text-green-700 bg-green-50/40', ['JOB_WORK_RETURN_IN', 'VENDOR_RETURN_IN'])}
                      {cell(item.dispatch_out, 'px-4 py-3 text-right text-red-700 bg-red-50/40', ['SALE_OUT'])}
                      {cell(item.transfer_out, 'px-4 py-3 text-right text-red-700 bg-red-50/40', ['TRANSFER_OUT'])}
                      {cell(item.jw_out, 'px-4 py-3 text-right text-red-700 bg-red-50/40', ['JOB_WORK_OUT'])}
                      <td className={`px-4 py-3 text-right font-bold bg-gray-100/60 ${cl < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {(() => {
                          const href = ledgerLink(item, { from: fromDate, to: toDate })
                          return href ? <Link href={href} className="hover:underline">{fmtQ(cl)}</Link> : fmtQ(cl)
                        })()}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold bg-purple-50/60 ${item.current_stock < 0 ? 'text-red-600' : 'text-purple-800'}`}>
                        {liveHref ? <Link href={liveHref} className="hover:underline">{fmtQ(item.current_stock)}</Link> : fmtQ(item.current_stock)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Totals */}
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                  <td className="px-4 py-3 text-gray-700" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right text-blue-800">{fmtQ(totals.opening)}</td>
                  <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.purchase_in)}</td>
                  <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.transfer_in)}</td>
                  <td className="px-4 py-3 text-right text-green-800">{fmtQ(totals.jw_return)}</td>
                  <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.dispatch_out)}</td>
                  <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.transfer_out)}</td>
                  <td className="px-4 py-3 text-right text-red-800">{fmtQ(totals.jw_out)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${totals.closing < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                    {fmtQ(totals.closing)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${totals.current_stock < 0 ? 'text-red-700' : 'text-purple-800'}`}>
                    {fmtQ(totals.current_stock)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
