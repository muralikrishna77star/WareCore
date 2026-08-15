'use client'

import { ArrowUpRight } from 'lucide-react'
import { getJobWorkOrderStatusLabel } from '@/lib/utils'
import { useRecordPreview } from '@/components/RecordPreviewProvider'

interface JobWorkReturnOrder {
  status: string
}

interface JobWorkReturnItem {
  id: string
  purchase_line_id: string | null
  job_line_id: string | null
  item_name: string | null
  size_label: string | null
  quantity_sent: number
  quantity_transferred_out: number | null
  unit: string | null
  material_types: { description: string } | null
  material_sizes: { size_label: string } | null
  item_master: { item_code: string | null } | null
}

interface JobWorkReturnOutputItem {
  source_job_line_id: string | null
  quantity: number
}

interface JobWorkReturnClientProps {
  order: JobWorkReturnOrder
  items: JobWorkReturnItem[]
  outputItems: JobWorkReturnOutputItem[]
}

export default function JobWorkReturnClient({ order, items, outputItems }: JobWorkReturnClientProps) {
  const { openList } = useRecordPreview()

  const getReturnedQuantity = (jobLineId: string | null | undefined) => {
    if (!jobLineId) return 0
    return outputItems
      .filter(item => item.source_job_line_id === jobLineId)
      .reduce((total, item) => total + (Number(item.quantity) || 0), 0)
  }

  const statusColors: Record<string, string> = {
    dispatched: 'bg-blue-100 text-blue-800',
    partial_return: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[order.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {getJobWorkOrderStatusLabel(order.status)}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Input Materials <span className="text-sm font-normal text-gray-500">(Consumed)</span></h2>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Line ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item Code</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sent Out</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty Returned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-mono text-blue-700">
                    {item.purchase_line_id ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-indigo-700">
                    {item.job_line_id ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{item.item_master?.item_code ?? '—'}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {item.item_name ?? item.material_types?.description ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">
                    {item.quantity_sent?.toFixed(3)} <span className="text-xs text-gray-400">{item.unit ?? 'MT'}</span>
                    {Number(item.quantity_transferred_out) > 0 && (
                      <button
                        type="button"
                        onClick={() => openList('job_work_transfers_for_item', { itemId: item.id })}
                        className="inline-flex items-center gap-0.5 text-[10px] text-purple-600 font-normal underline decoration-dotted hover:text-purple-800"
                        title="View which job(s) this was transferred to"
                      >
                        {Number(item.quantity_transferred_out).toFixed(3)} transferred out <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">
                    {item.job_line_id ? getReturnedQuantity(item.job_line_id).toFixed(3) : '—'}
                    {item.job_line_id && <span className="text-xs font-normal text-gray-400 ml-1">{item.unit ?? 'MT'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
