import { notFound } from 'next/navigation'
import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_ORDER_BY_ID_QUERY, JOB_WORK_ITEMS_QUERY, JOB_WORK_OUTPUT_ITEMS_QUERY } from '@/lib/hasura/queries'
import { formatDate } from '@/lib/utils'
import JobWorkReturnClient from './JobWorkReturnClient'
import DeleteJobWorkButton from './DeleteJobWorkButton'

export default async function JobWorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [orderResult, itemsResult, outputItemsResult] = await Promise.all([
    hasuraQuery(JOB_WORK_ORDER_BY_ID_QUERY, { id }),
    hasuraQuery(JOB_WORK_ITEMS_QUERY, { job_work_order_id: id }),
    hasuraQuery(JOB_WORK_OUTPUT_ITEMS_QUERY, { job_work_order_id: id }),
  ])
  const order = orderResult.job_work_orders_by_pk
  if (!order) notFound()
  const items = itemsResult.job_work_items ?? []
  const outputItems = outputItemsResult.job_work_output_items ?? []

  const isOverdue =
    order.expected_return_date &&
    !order.actual_return_date &&
    new Date(order.expected_return_date) < new Date()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/jobwork" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Job Work
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Job Work Order: {order.reference_number ?? id.slice(0, 8)}
          </h1>
        </div>
        {isOverdue && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
            Overdue
          </span>
        )}
      </div>

      {/* Order Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(order.dispatch_date)}</p>
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
            <p className="text-xs text-gray-500 uppercase tracking-wide">Vendor</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{order.suppliers?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Expected Return</p>
            <p className={`text-sm font-medium mt-1 ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
              {order.expected_return_date ? formatDate(order.expected_return_date) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Actual Return</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {order.actual_return_date ? formatDate(order.actual_return_date) : 'Pending'}
            </p>
          </div>
        </div>
        {order.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Output Items — Produced Materials */}
      {outputItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Output Materials <span className="text-sm font-normal text-gray-500">(Produced)</span></h2>
              <p className="text-xs text-gray-400 mt-0.5">Items produced / processed by this job work</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produced Item</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Produced</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Line ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outputItems.map((item: any, idx: number) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {item.item_name ?? item.material_types?.description ?? '—'}
                        {item.size_label && <span className="ml-1 text-gray-400 text-xs">{item.size_label}</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 text-right font-mono">
                        {Number(item.quantity).toFixed(3)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{item.unit}</td>
                      <td className="px-6 py-4">
                        {item.source_job_line_id ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {item.source_job_line_id}
                          </span>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Status + Return Form (client) */}
      <JobWorkReturnClient order={order} items={items ?? []} />

      <div className="flex gap-3 mt-6">
        {order.status !== 'cancelled' && order.status !== 'completed' && (
          <Link href={`/jobwork/${order.id}/edit`} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700">
            Edit Order
          </Link>
        )}
        <Link href="/jobwork/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          New Order
        </Link>
        <Link href="/jobwork" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Orders
        </Link>
        <DeleteJobWorkButton orderId={order.id} />
      </div>
    </div>
  )
}
