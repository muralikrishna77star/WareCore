export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_ORDERS_QUERY, VENDOR_STOCK_QUERY } from '@/lib/hasura/queries'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  partial_return: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default async function JobWorkPage() {
  const result = await hasuraQuery(JOB_WORK_ORDERS_QUERY)
  const orders = result.job_work_orders ?? []

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

      {/* Stock at Vendors Summary */}
      <VendorStockSummary />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🏭</p>
              <p className="text-gray-500">No job work orders yet.</p>
              <Link href="/jobwork/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Create first order →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Dispatch Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Items</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Expected Return</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o: any) => {
                  const items = o.job_work_items ?? []
                  const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity_sent), 0)
                  const totalReturned = items.reduce((s: number, i: any) => s + Number(i.quantity_received || 0), 0)
                  const isOverdue = o.expected_return_date && !o.actual_return_date && new Date(o.expected_return_date) < new Date()

                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {o.companies?.code}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">{o.suppliers?.name || '—'}</td>
                      <td className="px-6 py-3">
                        <p className="text-gray-700">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-gray-500">{totalQty.toFixed(3)} dispatched · {totalReturned.toFixed(3)} returned</p>
                      </td>
                      <td className={`px-6 py-3 whitespace-nowrap ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                        {o.expected_return_date ? formatDate(o.expected_return_date) : '—'}
                        {isOverdue && <span className="ml-1 text-xs">⚠ Overdue</span>}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[o.status] || 'bg-gray-100 text-gray-700'}`}>
                          {o.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/jobwork/${o.id}`} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                          View
                        </Link>
                      </td>
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
