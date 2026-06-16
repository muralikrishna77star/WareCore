export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_ORDERS_QUERY } from '@/lib/hasura/queries'

export default async function DispatchPage() {
  const result = await hasuraQuery(DISPATCH_ORDERS_QUERY)
  const orders = result.dispatch_orders ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sale Entry</h1>
          <p className="mt-1 text-sm text-gray-500">Sales invoices and customer dispatches</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dispatch/vendor-direct/new"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
          >
            Sell from Vendor
          </Link>
          <Link
            href="/dispatch/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            + New Sale
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🚚</p>
              <p className="text-gray-500">No sale entries yet.</p>
              <Link href="/dispatch/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Create first sale →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Sale Ref ID</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Qty</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Amount</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o: any) => {
                  const dispItems = o.dispatch_items ?? []
                  const totalQty = dispItems.reduce((s: number, i: any) => s + Number(i.quantity), 0)
                  const totalAmt = dispItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
                  const cancelled = o.status === 'cancelled'

                  return (
                    <tr key={o.id} className={`hover:bg-gray-50 ${cancelled ? 'opacity-60' : ''}`}>
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {o.companies?.code}
                        </span>
                      </td>
                      <td className={`px-6 py-3 font-medium ${cancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {o.customers?.name || '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-500 font-mono text-xs">{o.sale_ref_id || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{o.vehicle_number || '—'}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-700">{totalQty.toFixed(3)}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-700">
                        {totalAmt > 0 ? `₹${totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-6 py-3">
                        {o.is_vendor_direct ? (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                            From Vendor
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-500 border border-gray-200">
                            Warehouse
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {cancelled ? (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 border border-red-200">
                            Cancelled
                          </span>
                        ) : o.status === 'draft' ? (
                          <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 border border-yellow-200">
                            Draft
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 flex gap-2">
                        <Link href={`/dispatch/${o.id}`} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
                          View
                        </Link>
                        {(o.status === 'draft' || o.status === 'active') && (
                          <Link href={`/dispatch/${o.id}/edit`} className="text-yellow-600 hover:text-yellow-800 text-xs font-medium">
                            Edit
                          </Link>
                        )}
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
