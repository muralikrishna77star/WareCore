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
import { PrintButton } from '@/components/PrintButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  purchase: { label: 'Purchase', color: 'bg-green-100 text-green-800' },
  transfer_in: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  transfer_out: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  dispatch: { label: 'Dispatch', color: 'bg-red-100 text-red-800' },
  job_work_out: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  job_work_return: { label: 'Job Work Return', color: 'bg-teal-100 text-teal-800' },
  adjustment: { label: 'Adjustment', color: 'bg-gray-100 text-gray-800' },
}

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

export default async function MovementsReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    warehouse?: string
    entry_type?: string
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
  if (params.entry_type) conditions.push({ entry_type: { _eq: params.entry_type } })
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
  // Stock Movements ledger page.
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

  const movements: any[] = result.stock_ledger ?? []

  const totalIn = movements
    .filter(m => ['purchase', 'transfer_in', 'job_work_return'].includes(m.entry_type))
    .reduce((s, m) => s + Number(m.quantity || 0), 0)
  const totalOut = movements
    .filter(m => ['transfer_out', 'dispatch', 'job_work_out'].includes(m.entry_type))
    .reduce((s, m) => s + Number(m.quantity || 0), 0)

  const exportRows = movements.map((m: any) => ({
    'Date': formatDate(m.entry_date),
    'Type': (entryTypeConfig[m.entry_type] ?? { label: m.entry_type }).label,
    'Company': m.companies?.name ?? '',
    'Warehouse': m.warehouses?.name ?? '',
    'Material': m.material_types?.description ?? '',
    'Size': m.material_sizes?.size_label ?? m.size_label ?? '',
    'Qty (T)': Number(m.quantity),
    'Reference': m.reference_id ?? '',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movements Report</h1>
          <p className="text-sm text-gray-500 mt-1">Stock ledger movements by type</p>
        </div>
        <div className="flex items-center gap-2">
          {movements.length > 0 && (
            <ExportExcelButton rows={exportRows} filename={`Movements_Report_${fromDate}_to_${toDate}`} sheetName="Movements" />
          )}
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Movements Report</h1>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Entry Type</label>
            <select name="entry_type" defaultValue={params.entry_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Types</option>
              {Object.entries(entryTypeConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
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
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-gray-50 p-4">
          <p className="text-xs text-gray-500">Total Entries</p>
          <p className="text-xl font-bold text-gray-800">{movements.length}</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total In</p>
          <p className="text-xl font-bold text-green-700">+{totalIn.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Total Out</p>
          <p className="text-xl font-bold text-red-700">-{totalOut.toFixed(3)} T</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{movements.length} entr{movements.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {movements.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No movements found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Warehouse</th>
                  <th className="px-4 py-3 text-left">Material</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Qty (T)</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((m: any) => {
                  const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800' }
                  const isIn = ['purchase', 'transfer_in', 'job_work_return'].includes(m.entry_type)
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{formatDate(m.entry_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{m.companies?.name}</td>
                      <td className="px-4 py-3 text-gray-500">{m.warehouses?.name}</td>
                      <td className="px-4 py-3 font-medium">{m.material_types?.description}</td>
                      <td className="px-4 py-3 text-gray-500">{m.material_sizes?.size_label ?? m.size_label ?? '—'}</td>
                      <td className={`px-4 py-3 text-right font-medium ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                        {isIn ? '+' : '-'}{Math.abs(Number(m.quantity)).toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{m.reference_id ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={6}>Net Movement</td>
                  <td className={`px-4 py-3 text-right ${totalIn - totalOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {totalIn - totalOut >= 0 ? '+' : ''}{(totalIn - totalOut).toFixed(3)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
