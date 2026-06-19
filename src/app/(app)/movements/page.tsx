export const dynamic = 'force-dynamic'

import { formatDate, getEntryTypeLabel, getJobWorkOrderStatusLabel } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  STOCK_LEDGER_FILTERED_QUERY,
  STOCK_LEDGER_OPENING_BALANCE_QUERY,
  ACTIVE_COMPANIES_QUERY,
  ACTIVE_WAREHOUSES_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
  PURCHASE_BILL_IDS_QUERY,
  JOB_WORK_ORDER_IDS_QUERY,
  PURCHASE_BILLS_BY_IDS_QUERY,
  JOB_WORK_ORDERS_BY_IDS_QUERY,
} from '@/lib/hasura/queries'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

const entryTypeOptions = [
  'PURCHASE_IN',
  'PURCHASE_CANCEL',
  'VENDOR_RETURN_IN',
  'SALE_OUT',
  'SALE_CANCEL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'JOB_WORK_OUT',
  'JOB_WORK_RETURN_IN',
  'JOB_WORK_OUTPUT_IN',
  'JOB_WORK_CANCEL',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
]

const entryColors: Record<string, string> = {
  PURCHASE_IN: 'bg-green-100 text-green-800',
  PURCHASE_CANCEL: 'bg-gray-100 text-gray-700',
  VENDOR_RETURN_IN: 'bg-teal-100 text-teal-800',
  SALE_OUT: 'bg-red-100 text-red-800',
  SALE_CANCEL: 'bg-gray-100 text-gray-700',
  JOB_WORK_RETURN_IN: 'bg-blue-100 text-blue-800',
  JOB_WORK_OUTPUT_IN: 'bg-cyan-100 text-cyan-800',
  JOB_WORK_CANCEL: 'bg-gray-100 text-gray-700',
  TRANSFER_IN: 'bg-indigo-100 text-indigo-800',
  ADJUSTMENT_IN: 'bg-cyan-100 text-cyan-800',
  JOB_WORK_OUT: 'bg-orange-100 text-orange-800',
  TRANSFER_OUT: 'bg-yellow-100 text-yellow-800',
  ADJUSTMENT_OUT: 'bg-pink-100 text-pink-800',
}

const jobWorkStatusOptions: { value: string; color: string }[] = [
  { value: 'dispatched', color: 'bg-blue-100 text-blue-800' },
  { value: 'partial_return', color: 'bg-orange-100 text-orange-800' },
  { value: 'completed', color: 'bg-green-100 text-green-800' },
  { value: 'cancelled', color: 'bg-red-100 text-red-800' },
]
const jobWorkStatusLabel = (status: string) => getJobWorkOrderStatusLabel(status)
const jobWorkStatusColor = (status: string) =>
  jobWorkStatusOptions.find((s) => s.value === status)?.color ?? 'bg-gray-100 text-gray-700'

type ItemOption = ComboOption & {
  material_type_id: string
  material_size_id: string | null
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string
    warehouse?: string
    entry_type?: string
    item?: string
    vendor?: string
    job_work_status?: string
    from?: string
    to?: string
  }>
}) {
  const params = await searchParams
  const today = new Date().toISOString().split('T')[0]
  const fromDate = params.from || today
  const toDate = params.to || today

  const [compResult, whResult, supResult, itemResult] = await Promise.all([
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])

  const companies: any[] = compResult.companies ?? []
  const allWarehouses: any[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w: any) => w.company_id === params.company)
    : allWarehouses
  const suppliers: any[] = supResult.suppliers ?? []

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
  const itemLookup = new Map<string, { item_code: string; item_name: string }>()
  for (const i of itemRows) {
    itemLookup.set(`${i.material_type_id}|${i.material_size_id ?? ''}`, { item_code: i.item_code, item_name: i.item_name })
  }
  const itemLabelFor = (row: { material_type_id?: string | null; material_size_id?: string | null; material_types?: { description: string } | null }) => {
    const info = itemLookup.get(`${row.material_type_id ?? ''}|${row.material_size_id ?? ''}`)
    return info ? `${info.item_code} — ${info.item_name}` : row.material_types?.description || '—'
  }

  const conditions: Record<string, unknown>[] = []
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (params.entry_type) conditions.push({ entry_type: { _eq: params.entry_type } })
  conditions.push({ entry_date: { _gte: fromDate } })
  conditions.push({ entry_date: { _lte: toDate } })
  if (selectedItem) {
    conditions.push({ material_type_id: { _eq: selectedItem.material_type_id } })
    if (selectedItem.material_size_id) {
      conditions.push({ material_size_id: { _eq: selectedItem.material_size_id } })
    }
  }

  // Vendor / Job Work Status filters need to be resolved to stock_ledger.reference_id
  // values up front, since vendor and job work status aren't stored on stock_ledger itself.
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

  if (!noResults && params.job_work_status) {
    const statusOrdersResult = await hasuraQuery(JOB_WORK_ORDER_IDS_QUERY, {
      where: { status: { _eq: params.job_work_status } },
    })
    const refIds = (statusOrdersResult.job_work_orders ?? []).map((o: any) => o.id)
    if (refIds.length === 0) {
      noResults = true
    } else {
      conditions.push({ reference_type: { _eq: 'job_work' } })
      conditions.push({ reference_id: { _in: refIds } })
    }
  }

  const where = conditions.length > 0 ? { _and: conditions } : {}

  const movResult = noResults
    ? { stock_ledger: [] }
    : await hasuraQuery(STOCK_LEDGER_FILTERED_QUERY, { where })
  const movements: any[] = movResult.stock_ledger ?? []

  // Running balance is computed per (company, warehouse, material_type, material_size)
  // group, since stock balance only makes sense within one such combination.
  const groupKey = (m: any) =>
    `${m.companies?.id ?? ''}|${m.warehouses?.id ?? ''}|${m.material_type_id ?? ''}|${m.material_size_id ?? ''}`

  const groupsByKey = new Map<string, { company_id: string; warehouse_id: string; material_type_id: string; material_size_id: string | null }>()
  for (const m of movements) {
    const key = groupKey(m)
    if (!groupsByKey.has(key) && m.companies?.id && m.warehouses?.id && m.material_type_id) {
      groupsByKey.set(key, {
        company_id: m.companies.id,
        warehouse_id: m.warehouses.id,
        material_type_id: m.material_type_id,
        material_size_id: m.material_size_id ?? null,
      })
    }
  }

  const openingByKey = new Map<string, number>()
  await Promise.all(
    Array.from(groupsByKey.entries()).map(async ([key, g]) => {
      const openingWhere = {
        company_id: { _eq: g.company_id },
        warehouse_id: { _eq: g.warehouse_id },
        material_type_id: { _eq: g.material_type_id },
        material_size_id: g.material_size_id ? { _eq: g.material_size_id } : { _is_null: true },
        entry_date: { _lt: fromDate },
      }
      const res = await hasuraQuery(STOCK_LEDGER_OPENING_BALANCE_QUERY, { where: openingWhere })
      openingByKey.set(key, Number(res.stock_ledger_aggregate?.aggregate?.sum?.quantity ?? 0))
    })
  )

  const ascending = [...movements].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    if (ta !== tb) return ta - tb
    // Same-instant entries (e.g. a trigger inserting a return + sale together):
    // apply inflows before outflows so the running balance never dips through a
    // phantom negative before the offsetting inflow lands.
    return Number(b.quantity) - Number(a.quantity)
  })
  const runningByKey = new Map<string, number>(openingByKey)
  const balanceById = new Map<string, number>()
  for (const m of ascending) {
    const key = groupKey(m)
    const running = (runningByKey.get(key) ?? 0) + Number(m.quantity)
    runningByKey.set(key, running)
    balanceById.set(m.id, running)
  }

  // Enrich purchase / job work entries with vendor name (and job work status) for display.
  const purchaseBillIds = Array.from(new Set(
    movements.filter((m) => m.reference_type === 'purchase_bill' && m.reference_id).map((m) => m.reference_id)
  ))
  const jobWorkOrderIds = Array.from(new Set(
    movements.filter((m) => m.reference_type === 'job_work' && m.reference_id).map((m) => m.reference_id)
  ))

  const [purchaseBillsResult, jobWorkOrdersResult] = await Promise.all([
    purchaseBillIds.length > 0
      ? hasuraQuery(PURCHASE_BILLS_BY_IDS_QUERY, { ids: purchaseBillIds })
      : Promise.resolve({ purchase_bills: [] }),
    jobWorkOrderIds.length > 0
      ? hasuraQuery(JOB_WORK_ORDERS_BY_IDS_QUERY, { ids: jobWorkOrderIds })
      : Promise.resolve({ job_work_orders: [] }),
  ])

  const vendorByBillId = new Map<string, string>()
  for (const b of purchaseBillsResult.purchase_bills ?? []) {
    if (b.suppliers?.name) vendorByBillId.set(b.id, b.suppliers.name)
  }
  const jobWorkInfoById = new Map<string, { vendor?: string; status?: string }>()
  for (const o of jobWorkOrdersResult.job_work_orders ?? []) {
    jobWorkInfoById.set(o.id, { vendor: o.suppliers?.name, status: o.status })
  }

  const vendorFor = (row: any): string | null => {
    if (row.reference_type === 'purchase_bill' && row.reference_id) return vendorByBillId.get(row.reference_id) || null
    if (row.reference_type === 'job_work' && row.reference_id) return jobWorkInfoById.get(row.reference_id)?.vendor || null
    return null
  }
  const jobWorkStatusFor = (row: any): string | null => {
    if (row.reference_type === 'job_work' && row.reference_id) return jobWorkInfoById.get(row.reference_id)?.status || null
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock Movements</h1>
        <p className="mt-1 text-sm text-gray-500">Full ledger of all inventory movements</p>
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
              {companies?.map((c) => (
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
              {warehouses.map((w: any) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Entry Type</label>
            <select
              name="entry_type"
              defaultValue={params.entry_type || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Types</option>
              {entryTypeOptions.map((t) => (
                <option key={t} value={t}>{getEntryTypeLabel(t)}</option>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
            <select
              name="vendor"
              defaultValue={params.vendor || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Vendors</option>
              {suppliers.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Job Work Status</label>
            <select
              name="job_work_status"
              defaultValue={params.job_work_status || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All</option>
              {jobWorkStatusOptions.map((s) => (
                <option key={s.value} value={s.value}>{jobWorkStatusLabel(s.value)}</option>
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
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Filter
          </button>
          <a href="/movements" className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Clear
          </a>
        </div>
      </form>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {movements.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">No movements found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase text-right">Quantity</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase text-right">Balance</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Job Work Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((m: any) => {
                  const isIn = Number(m.quantity) > 0
                  const vendor = vendorFor(m)
                  const jwStatus = jobWorkStatusFor(m)
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                        {formatDate(m.entry_date)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${entryColors[m.entry_type] || 'bg-gray-100 text-gray-700'}`}>
                          {getEntryTypeLabel(m.entry_type)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{m.companies?.code}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.warehouses?.name}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{itemLabelFor(m)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.size_label || m.material_sizes?.size_label || '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${isIn ? 'text-green-700' : 'text-red-700'}`}>
                        {isIn ? '+' : '-'}{Math.abs(m.quantity).toFixed(3)} {m.material_types?.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                        {balanceById.has(m.id) ? `${balanceById.get(m.id)!.toFixed(3)} ${m.material_types?.unit ?? ''}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{vendor || '—'}</td>
                      <td className="px-4 py-2.5">
                        {jwStatus ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${jobWorkStatusColor(jwStatus)}`}>
                            {jobWorkStatusLabel(jwStatus)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{m.reference_number || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{m.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
