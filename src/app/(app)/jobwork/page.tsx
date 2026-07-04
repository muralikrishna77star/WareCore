export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_ORDERS_QUERY, VENDOR_STOCK_QUERY, ACTIVE_SUPPLIERS_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import JobWorkTable from './JobWorkTable'
import { ListingFilters } from '@/components/ListingFilters'
import { ListingSummary } from '@/components/ListingSummary'

export default async function JobWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; vendor?: string; item?: string }>
}) {
  const params = await searchParams

  const today = new Date()
  const fifteenDaysAgo = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000)
  const fromDate = params.from || fifteenDaysAgo.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { dispatch_date: { _gte: fromDate } },
    { dispatch_date: { _lte: toDate } },
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
          <h1 className="text-2xl font-bold text-gray-900">Job Work Orders</h1>
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

      <ListingFilters
        basePath="/jobwork"
        fromDate={fromDate}
        toDate={toDate}
        partyLabel="Vendor"
        partyName="vendor"
        partyValue={params.vendor || ''}
        partyOptions={vendors}
        itemValue={params.item || ''}
        itemOptions={itemOptions}
      />

      {/* Stock at Vendors Summary */}
      <VendorStockSummary />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🏭</p>
              <p className="text-gray-500">No job work orders in the selected range.</p>
            </div>
          ) : (
            <JobWorkTable orders={orders} />
          )}
        </div>
      </div>
    </div>
  )
}

async function VendorStockSummary() {
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

  return (
    <div className="rounded-xl border bg-amber-50 border-amber-200 p-4">
      <h2 className="text-sm font-semibold text-amber-800 mb-3">📍 Material Currently at Vendors</h2>
      <div className="flex flex-wrap gap-4">
        {Object.entries(vendorGroups).map(([id, { name, rows }]) => (
          <div key={id} className="bg-white rounded-lg border border-amber-200 px-4 py-3 min-w-48">
            <p className="font-semibold text-gray-800 text-sm">{name}</p>
            {rows.map((r, i) => (
              <p key={i} className="text-xs text-gray-600 mt-1">
                {r.material_type_name} {r.size_label ? `(${r.size_label})` : ''}: <strong>{Number(r.pending_quantity).toFixed(3)}</strong>
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
