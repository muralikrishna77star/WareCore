export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_CANCELLATION_BY_ID_QUERY } from '@/lib/hasura/queries'

export default async function JobWorkCancellationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await hasuraQuery(JOB_WORK_CANCELLATION_BY_ID_QUERY, { id })
  const record = result.job_work_cancellations_by_pk
  if (!record) notFound()

  const items = record.job_work_cancellation_items ?? []
  const outputItems = record.job_work_cancellation_output_items ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/jobwork-cancellations" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Job Work Cancellations
          </Link>
          <h1 className="text-2xl font-bold text-gray-400 line-through">
            {record.reference_number || `Job Work ${id.slice(0, 8)}`}
          </h1>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800 border border-red-200">
          Cancelled
        </span>
      </div>

      {/* Order Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 opacity-80">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{formatDate(record.dispatch_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.company_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Warehouse</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.warehouse_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Vendor</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.vendor_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Expected Return</p>
            <p className="text-sm font-medium text-gray-700 mt-1">
              {record.expected_return_date ? formatDate(record.expected_return_date) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Actual Return</p>
            <p className="text-sm font-medium text-gray-700 mt-1">
              {record.actual_return_date ? formatDate(record.actual_return_date) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Status at Cancellation</p>
            <p className="text-sm font-medium text-gray-700 mt-1 capitalize">{record.status?.replace('_', ' ') ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cancelled On</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.cancelled_at ? formatDate(record.cancelled_at) : '—'}</p>
          </div>
        </div>
        {record.work_description && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Work Description</p>
            <p className="text-sm text-gray-700">{record.work_description}</p>
          </div>
        )}
        {record.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{record.notes}</p>
          </div>
        )}
        {record.cancelled_notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cancellation Reason</p>
            <p className="text-sm text-gray-700">{record.cancelled_notes}</p>
          </div>
        )}
      </div>

      {/* Input Materials */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 opacity-80">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Input Materials <span className="text-sm font-normal text-gray-500">(Sent to Vendor)</span></h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Sent</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Received</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Line ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-400">No line items.</td></tr>
              ) : items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-700">{item.item_name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.material_type_name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.size_label || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right font-mono">{Number(item.quantity_sent ?? 0).toFixed(3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right font-mono">{Number(item.quantity_received ?? 0).toFixed(3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.unit || '—'}</td>
                  <td className="px-6 py-4">
                    {item.purchase_line_id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200">
                        {item.purchase_line_id}
                      </span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-4">
                    {item.job_line_id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {item.job_line_id}
                      </span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Output Materials */}
      {outputItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 opacity-80">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Output Materials <span className="text-sm font-normal text-gray-500">(Produced)</span></h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Produced Item</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Produced</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Line ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outputItems.map((item: any, idx: number) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700">{item.item_name || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.material_type_name || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.size_label || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 text-right font-mono">{Number(item.quantity ?? 0).toFixed(3)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.unit || '—'}</td>
                    <td className="px-6 py-4">
                      {item.source_job_line_id ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {item.source_job_line_id}
                        </span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Link href="/jobwork-cancellations"
        className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
        ← Back to Cancellations
      </Link>
    </div>
  )
}
