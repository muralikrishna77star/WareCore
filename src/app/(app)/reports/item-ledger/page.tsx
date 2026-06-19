export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import {
  ITEM_STOCK_LEDGER_QUERY,
  ITEM_STOCK_AT_VENDORS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_MATERIAL_SIZES_QUERY,
} from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { ItemComboBox } from '@/components/ItemComboBox'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  PURCHASE_IN: { label: 'Purchase In', color: 'bg-green-100 text-green-800' },
  VENDOR_RETURN_IN: { label: 'Vendor Return In', color: 'bg-green-100 text-green-800' },
  SALE_OUT: { label: 'Sale / Dispatch', color: 'bg-red-100 text-red-800' },
  SALE_CANCEL: { label: 'Sale Cancelled', color: 'bg-gray-100 text-gray-700' },
  PURCHASE_CANCEL: { label: 'Purchase Cancelled', color: 'bg-gray-100 text-gray-700' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  TRANSFER_IN: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  JOB_WORK_OUT: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_CANCEL: { label: 'Job Work Cancelled', color: 'bg-gray-100 text-gray-700' },
  ADJUSTMENT_IN: { label: 'Adjustment In', color: 'bg-gray-100 text-gray-800' },
  ADJUSTMENT_OUT: { label: 'Adjustment Out', color: 'bg-gray-100 text-gray-800' },
}

type ItemMaster = {
  id: string
  item_code: string
  item_name: string
  material_type_id: string
  material_size_id: string | null
  size_label?: string | null
  unit: string
  material_types?: { description: string; unit: string }
  material_sizes?: { size_label: string } | null
}

type LedgerEntry = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  companies?: { name: string; code: string } | null
  warehouses?: { name: string } | null
  material_types?: { description: string; unit: string } | null
  material_sizes?: { size_label: string } | null
}

export default async function ItemStockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; size?: string; company?: string; warehouse?: string; from?: string; to?: string }>
}) {
  const params = await searchParams

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const [itemResult, compResult, whResult, sizeResult] = await Promise.all([
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_MATERIAL_SIZES_QUERY),
  ])

  const items: ItemMaster[] = itemResult.item_master ?? []
  const companies: { id: string; name: string }[] = compResult.companies ?? []
  const allWarehouses: { id: string; name: string; company_id: string }[] = whResult.warehouses ?? []
  const allSizes: { id: string; material_type_id: string | null; size_label: string }[] = sizeResult.material_sizes ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w) => w.company_id === params.company)
    : allWarehouses

  const selectedItem = params.item ? items.find((i) => i.id === params.item) ?? null : null

  const sizesForItem = selectedItem
    ? allSizes.filter((s) => !s.material_type_id || s.material_type_id === selectedItem.material_type_id)
    : allSizes
  const selectedSizeId = params.size || selectedItem?.material_size_id || ''

  let openingBalance = 0
  let entries: LedgerEntry[] = []
  let vendorStock: { vendor_name: string; pending_quantity: number | string; unit: string }[] = []

  if (selectedItem) {
    const baseConditions: Record<string, unknown>[] = [
      { material_type_id: { _eq: selectedItem.material_type_id } },
      selectedSizeId
        ? { material_size_id: { _eq: selectedSizeId } }
        : { material_size_id: { _is_null: true } },
    ]
    if (params.company) baseConditions.push({ company_id: { _eq: params.company } })
    if (params.warehouse) baseConditions.push({ warehouse_id: { _eq: params.warehouse } })

    const openingWhere = { _and: [...baseConditions, { entry_date: { _lt: fromDate } }] }
    const periodWhere = {
      _and: [...baseConditions, { entry_date: { _gte: fromDate } }, { entry_date: { _lte: toDate } }],
    }

    const result = await hasuraQuery(ITEM_STOCK_LEDGER_QUERY, {
      opening_where: openingWhere,
      period_where: periodWhere,
    })
    openingBalance = Number(result.opening_agg?.aggregate?.sum?.quantity ?? 0)
    entries = result.entries ?? []

    const selectedSizeLabel = selectedSizeId
      ? allSizes.find((s) => s.id === selectedSizeId)?.size_label ?? null
      : null
    const vendorWhere: Record<string, unknown> = { material_type_id: { _eq: selectedItem.material_type_id } }
    if (selectedSizeLabel) vendorWhere.size_label = { _eq: selectedSizeLabel }
    if (params.company) vendorWhere.company_id = { _eq: params.company }
    const vendorResult = await hasuraQuery(ITEM_STOCK_AT_VENDORS_QUERY, { where: vendorWhere })
    vendorStock = vendorResult.v_stock_at_vendors ?? []
  }

  let running = openingBalance
  const ledgerRows = entries.map((e) => {
    running += Number(e.quantity)
    return { ...e, balance: running }
  })
  const closingBalance = running

  const totalIn = entries
    .filter((e) => Number(e.quantity) > 0)
    .reduce((s, e) => s + Number(e.quantity), 0)
  const totalOut = entries
    .filter((e) => Number(e.quantity) < 0)
    .reduce((s, e) => s + Math.abs(Number(e.quantity)), 0)

  const unit = selectedItem?.material_types?.unit || selectedItem?.unit || 'tons'
  const sizeLabel = selectedItem?.material_sizes?.size_label || selectedItem?.size_label
  const itemTitle = selectedItem
    ? `${selectedItem.item_code} — ${selectedItem.item_name}${sizeLabel ? ` (${sizeLabel})` : ''}`
    : null

  const fmtQ = (n: number) => n.toFixed(3)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Item Stock Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">
            Opening balance, movements, and running balance for a single item over a date range
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItem && <PrintButton />}
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Item Stock Ledger</h1>
        {itemTitle && <p className="text-sm text-gray-700 font-medium">{itemTitle}</p>}
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[16rem]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Item *</label>
            <ItemComboBox
              name="item"
              defaultValue={params.item || ''}
              defaultLabel={itemTitle || ''}
              placeholder="Search item by name or code…"
              options={items.map((i) => {
                const size = i.material_sizes?.size_label || i.size_label
                return {
                  id: i.id,
                  label: `${i.item_code} — ${i.item_name}${size ? ` (${size})` : ''}`,
                  search: `${i.item_code} ${i.item_name} ${size ?? ''}`.toLowerCase(),
                }
              })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
            <select
              name="size"
              defaultValue={selectedSizeId}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Sizes</option>
              {sizesForItem.map((s) => (
                <option key={s.id} value={s.id}>{s.size_label}</option>
              ))}
            </select>
          </div>

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

      {!selectedItem ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <p className="text-4xl mb-3">📒</p>
          <p className="text-gray-500 text-sm">Select an item above to view its stock ledger.</p>
        </div>
      ) : (
        <>
          {/* Item header */}
          <div className="rounded-xl border bg-white p-4 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-semibold text-gray-900">{itemTitle}</p>
              <p className="text-sm text-gray-500">Unit: {unit}</p>
            </div>
            <p className="text-sm text-gray-500">{fromDate} → {toDate}</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div className="rounded-xl border bg-blue-50 p-4">
              <p className="text-xs text-gray-500">Opening Balance</p>
              <p className={`text-xl font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                {fmtQ(openingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-green-50 p-4">
              <p className="text-xs text-gray-500">Total In</p>
              <p className="text-xl font-bold text-green-700">+{fmtQ(totalIn)}</p>
            </div>
            <div className="rounded-xl border bg-red-50 p-4">
              <p className="text-xs text-gray-500">Total Out</p>
              <p className="text-xl font-bold text-red-700">-{fmtQ(totalOut)}</p>
            </div>
            <div className="rounded-xl border bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Closing Balance</p>
              <p className={`text-xl font-bold ${closingBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(closingBalance)}
              </p>
            </div>
            <div className="rounded-xl border bg-purple-50 p-4">
              <p className="text-xs text-gray-500">At Vendor (Job Work)</p>
              <p className="text-xl font-bold text-purple-800">
                {fmtQ(vendorStock.reduce((s, v) => s + Number(v.pending_quantity), 0))}
              </p>
              {vendorStock.length > 1 && (
                <p className="text-[11px] text-gray-500 mt-1 leading-tight">
                  {vendorStock.map((v) => `${v.vendor_name}: ${fmtQ(Number(v.pending_quantity))}`).join(' · ')}
                </p>
              )}
              {vendorStock.length === 1 && (
                <p className="text-[11px] text-gray-500 mt-1">{vendorStock[0].vendor_name}</p>
              )}
            </div>
          </div>

          {/* Ledger table */}
          <div className="rounded-xl border bg-white overflow-hidden">
            <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
              <span className="font-semibold text-gray-700 text-sm">Ledger Entries</span>
              <span className="text-xs text-gray-500">{ledgerRows.length} entr{ledgerRows.length !== 1 ? 'ies' : 'y'}</span>
            </div>
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Reference</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Warehouse</th>
                    <th className="px-4 py-3 text-right">In</th>
                    <th className="px-4 py-3 text-right">Out</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-blue-50/50 font-medium">
                    <td className="px-4 py-3 text-gray-600" colSpan={7}>Opening Balance as of {fromDate}</td>
                    <td className={`px-4 py-3 text-right font-bold ${openingBalance < 0 ? 'text-red-600' : 'text-blue-800'}`}>
                      {fmtQ(openingBalance)}
                    </td>
                    <td />
                  </tr>
                  {ledgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                        No movements for this item in the selected period.
                      </td>
                    </tr>
                  ) : ledgerRows.map((row) => {
                    const cfg = entryTypeConfig[row.entry_type] ?? { label: row.entry_type, color: 'bg-gray-100 text-gray-800' }
                    const qty = Number(row.quantity)
                    const lineId = row.sub_purchase_line_id || row.purchase_line_id
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {row.reference_number || '—'}
                          {lineId && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {lineId}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{row.companies?.name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{row.warehouses?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{qty > 0 ? fmtQ(qty) : ''}</td>
                        <td className="px-4 py-3 text-right text-red-600 font-medium">{qty < 0 ? fmtQ(Math.abs(qty)) : ''}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {fmtQ(row.balance)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{row.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                    <td className="px-4 py-3 text-gray-700" colSpan={5}>Closing Balance as of {toDate}</td>
                    <td className="px-4 py-3 text-right text-green-800">+{fmtQ(totalIn)}</td>
                    <td className="px-4 py-3 text-right text-red-800">-{fmtQ(totalOut)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${closingBalance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmtQ(closingBalance)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
