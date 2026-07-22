export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFER_CANCELLATION_BY_ID_QUERY } from '@/lib/hasura/queries'

export default async function JobWorkTransferCancellationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await hasuraQuery(JOB_WORK_TRANSFER_CANCELLATION_BY_ID_QUERY, { id })
  const record = result.job_work_transfer_cancellations_by_pk
  if (!record) notFound()

  const items = record.job_work_transfer_cancellation_items ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/jobwork-transfer-cancellations" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Job Work Transfer Deletions
          </Link>
          <h1 className="text-2xl font-bold text-gray-400 line-through">
            {record.transfer_number || `Transfer ${id.slice(0, 8)}`}
          </h1>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800 border border-red-200">
          Deleted
        </span>
      </div>

      {/* Transfer Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 opacity-80">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Transfer Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Transfer Date</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{formatDate(record.transfer_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Order</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.from_reference_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Vendor</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.from_vendor_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Order</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.to_reference_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Vendor</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.to_vendor_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Cancelled On</p>
            <p className="text-sm font-medium text-gray-700 mt-1">{record.cancelled_at ? formatDate(record.cancelled_at) : '—'}</p>
          </div>
        </div>
        {record.reason && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Transfer Reason</p>
            <p className="text-sm text-gray-700">{record.reason}</p>
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
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Deletion Reason</p>
            <p className="text-sm text-gray-700">{record.cancelled_notes}</p>
          </div>
        )}
        {record.job_work_cancellation_id && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <Link
              href={`/jobwork-cancellations/${record.job_work_cancellation_id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              View destination order cancellation →
            </Link>
          </div>
        )}
      </div>

      {/* Items Transferred */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 opacity-80">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Items <span className="text-sm font-normal text-gray-500">(Transferred)</span></h2>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Transferred</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No line items.</td></tr>
              ) : items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-700">{item.item_name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.material_type_name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.size_label || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700 text-right font-mono">{Number(item.quantity_transferred ?? 0).toFixed(3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.unit || '—'}</td>
                  <td className="px-6 py-4">
                    {item.purchase_line_id ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-blue-50 text-blue-700 border border-blue-200">
                        {item.purchase_line_id}
                      </span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Link href="/jobwork-transfer-cancellations"
        className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
        ← Back to Transfer Deletions
      </Link>
    </div>
  )
}
