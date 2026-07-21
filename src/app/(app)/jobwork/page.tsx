export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_ORDERS_QUERY, JOB_WORK_ORDERS_MAX_CREATED_QUERY, VENDOR_STOCK_QUERY, ACTIVE_SUPPLIERS_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import { defaultCreatedRange, nextDay } from '@/lib/dateRange'
import JobWorkTable from './JobWorkTable'
import { ListingSummary } from '@/components/ListingSummary'

export default async function JobWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; vendor?: string; item?: string }>
}) {
  const params = await searchParams

  const maxCreatedResult = await hasuraQuery(JOB_WORK_ORDERS_MAX_CREATED_QUERY)
  const maxCreatedAt = maxCreatedResult.job_work_orders_aggregate?.aggregate?.max?.created_at
  const defaults = defaultCreatedRange(maxCreatedAt)
  const fromDate = params.from || defaults.from
  const toDate = params.to || defaults.to

  const conditions: Record<string, unknown>[] = [
    { created_at: { _gte: fromDate } },
    { created_at: { _lt: nextDay(toDate) } },
  ]
  if (params.vendor) conditions.push({ vendor_id: { _eq: params.vendor } })
  if (params.item) conditions.push({ job_work_items: { item_master_id: { _eq: params.item } } })

  const [ordersResult, vendorsResult, itemsResult] = await Promise.all([
    hasuraQuery(JOB_WORK_ORDERS_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])
  const orders = ordersResult.job_work_orders ?? []
  const vendors: { id: string; name: string }[] = vendorsResult.suppliers ?? []
  const itemOptions: { id: string; item_code: string; item_name: string }[] = itemsResult.item_master ?? []

  const totalQuantity = orders.reduce(
    (s: number, o: any) => s + (o.job_work_items ?? []).reduce((s2: number, i: any) => s2 + Number(i.quantity_sent || 0), 0),
    0
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Job Work Orders</h1>
            <VendorStockBadge />
          </div>
          <p className="mt-1 text-sm text-gray-500">Material sent to vendors for processing</p>
        </div>
        <Link
          href="/jobwork/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Job Work
        </Link>
      </div>

      <ListingSummary count={orders.length} countLabel="order" totalQuantity={totalQuantity} />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <JobWorkTable
            orders={orders ?? []}
            fromDate={fromDate}
            toDate={toDate}
            basePath="/jobwork"
            vendors={vendors}
            vendorValue={params.vendor || ''}
            itemOptions={itemOptions}
            itemValue={params.item || ''}
            emptyMessage="No job work orders in the selected range."
          />
        </div>
      </div>
    </div>
  )
}

async function VendorStockBadge() {
  let data: any[] = []
  try {
    const result = await hasuraQuery(VENDOR_STOCK_QUERY)
    data = result.v_stock_at_vendors ?? []
  } catch { /* view may not exist yet */ }

  if (data.length === 0) return null

  type VendorRow = { vendor_id: string; vendor_name: string; material_type_name: string; size_label: string | null; pending_quantity: number }

  const vendorGroups: Record<string, { name: string; rows: VendorRow[] }> = {}
  for (const row of data as VendorRow[]) {
    if (!vendorGroups[row.vendor_id]) vendorGroups[row.vendor_id] = { name: row.vendor_name, rows: [] }
    vendorGroups[row.vendor_id].rows.push(row)
  }
  const vendorCount = Object.keys(vendorGroups).length

  return (
    <div className="group relative inline-block">
      <span className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
        📍 Material at Vendors
        <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">{vendorCount}</span>
      </span>
      <div className="invisible absolute left-0 top-full z-20 mt-2 w-max max-w-lg opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100">
        <div className="rounded-xl border border-amber-200 bg-white p-4 shadow-lg">
          <p className="mb-3 text-sm font-semibold text-amber-800">📍 Material Currently at Vendors</p>
          <div className="flex flex-wrap gap-4">
            {Object.entries(vendorGroups).map(([id, { name, rows }]) => (
              <div key={id} className="min-w-48 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
                <p className="text-sm font-semibold text-gray-800">{name}</p>
                {rows.map((r, i) => (
                  <p key={i} className="mt-1 text-xs text-gray-600">
                    {r.material_type_name} {r.size_label ? `(${r.size_label})` : ''}: <strong>{Number(r.pending_quantity).toFixed(3)}</strong>
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
