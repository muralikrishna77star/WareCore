export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_ORDER_BY_ID_QUERY, DISPATCH_ITEMS_QUERY, USER_PROFILE_BY_ID_QUERY } from '@/lib/hasura/queries'
import CancelDispatchButton from './CancelDispatchButton'
import PurgeDispatchButton from './PurgeDispatchButton'

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [orderResult, itemsResult] = await Promise.all([
    hasuraQuery(DISPATCH_ORDER_BY_ID_QUERY, { id }),
    hasuraQuery(DISPATCH_ITEMS_QUERY, { dispatch_order_id: id }),
  ])
  const order = orderResult.dispatch_orders_by_pk
  if (!order) notFound()
  const items = itemsResult.dispatch_items ?? []

  let createdByName: string | null = null
  if (order.created_by) {
    const creatorResult = await hasuraQuery(USER_PROFILE_BY_ID_QUERY, { id: order.created_by }, { suppressError: true })
    createdByName = creatorResult.user_profiles_by_pk?.full_name ?? null
  }

  const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0)
  const totalQty = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0)

  const isCancelled = order.status === 'cancelled'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/dispatch" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Dispatch
          </Link>
          <h1 className={`text-2xl font-bold ${isCancelled ? 'text-gray-400' : 'text-gray-900'}`}>
            Dispatch: {order.invoice_number ?? id.slice(0, 8)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {order.is_vendor_direct && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200">
              From Vendor
            </span>
          )}
          {isCancelled ? (
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 border border-red-200">
              Cancelled
            </span>
          ) : order.status === 'draft' ? (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
              Draft
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
              Active
            </span>
          )}
        </div>
      </div>

      {/* Cancellation notice */}
      {isCancelled && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700 mb-1">
            This sale was cancelled on {formatDate(order.cancelled_at)}
          </p>
          {order.cancelled_notes && (
            <p className="text-sm text-red-600">Reason: {order.cancelled_notes}</p>
          )}
          <p className="text-xs text-red-500 mt-2">
            All stock deducted by this sale has been restored in the stock ledger.
          </p>
        </div>
      )}

      {/* Order Info */}
      <div className={`bg-white rounded-xl border border-gray-200 p-6 mb-6 ${isCancelled ? 'opacity-60' : ''}`}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Dispatch Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(order.dispatch_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.customers?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.companies?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.warehouses?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Vehicle</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.vehicle_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Driver</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.driver_name ?? '—'}</p>
          </div>
          {order.sale_ref_id && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Sale Ref ID</p>
              <p className="text-sm font-medium text-gray-900 mt-1 font-mono">{order.sale_ref_id}</p>
            </div>
          )}
          {order.is_vendor_direct && order.source_job_work_order_id && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Source Job Work Order</p>
              <Link href={`/jobwork/${order.source_job_work_order_id}`}
                className="text-sm font-medium text-amber-700 hover:underline mt-1 block">
                View Job Work Order →
              </Link>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created On</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDateTime(order.created_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created By</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{createdByName ?? '—'}</p>
          </div>
        </div>
        {order.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 ${isCancelled ? 'opacity-60' : ''}`}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Dispatched Items</h2>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity (MT)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Rate (₹/MT)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {item.item_name ?? '—'}
                    {item.sale_line_id && (
                      <span className="block text-[10px] font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1 mt-0.5">{item.sale_line_id}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{item.material_types?.description ?? '—'}</td>
                  <td className="px-6 py-4 text-sm font-mono text-blue-700">{item.purchase_line_id ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{item.size_label ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">{Number(item.quantity).toFixed(3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">
                    {item.rate ? formatCurrency(Number(item.rate)) : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">
                    {item.amount ? formatCurrency(Number(item.amount)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={5} className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">Totals</td>
                <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">{totalQty.toFixed(3)} MT</td>
                <td></td>
                <td className="px-6 py-4 text-sm font-bold text-blue-700 text-right">{formatCurrency(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/dispatch/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          New Dispatch
        </Link>
        <Link href="/dispatch" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Dispatches
        </Link>
        {(order.status === 'draft' || order.status === 'active') && !isCancelled && (
          <Link href={`/dispatch/${order.id}/edit`} className="px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600">
            {order.status === 'active' ? 'Edit Sale' : 'Edit Draft'}
          </Link>
        )}
        {!isCancelled && <CancelDispatchButton orderId={order.id} />}
        {isCancelled && <PurgeDispatchButton orderId={order.id} />}
      </div>
    </div>
  )
}
