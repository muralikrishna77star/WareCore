'use client'

import Link from 'next/link'
import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import { getJobWorkOrderStatusLabel, getJobWorkCompletionLabel, formatDate } from '@/lib/utils'
import { useRecordPreview } from '@/components/RecordPreviewProvider'
import type { ActivityLineSummary } from '@/lib/jobWorkActivity'

interface JobWorkReturnOrder {
  status: string
  completion_via?: string | null
  actual_return_date?: string | null
}

interface JobWorkReturnItem {
  id: string
  item_master_id: string | null
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
  lineSummaries: Record<string, ActivityLineSummary>
  /** Job Line ID -> the anchor of the first Output Materials row made from it. */
  outputAnchorByJobLine: Record<string, string>
  /** Date range for Item Stock Ledger links, so they open on this order's history. */
  ledgerRange: { from: string; to: string }
}

const fmt = (n: number) => (Math.abs(n) < 0.0005 ? 0 : n).toFixed(3)

export default function JobWorkReturnClient({
  order,
  items,
  outputItems,
  lineSummaries,
  outputAnchorByJobLine,
  ledgerRange,
}: JobWorkReturnClientProps) {
  const { openList } = useRecordPreview()

  const itemLedgerHref = (itemMasterId: string | null) =>
    itemMasterId ? `/reports/item-ledger?item=${itemMasterId}&from=${ledgerRange.from}&to=${ledgerRange.to}` : null

  const hasOutputs = outputItems.length > 0
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
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[order.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {getJobWorkOrderStatusLabel(order.status)}
        </span>
        {order.status === 'completed' && order.completion_via && (
          <span className="text-xs text-gray-600">
            {getJobWorkCompletionLabel(order.completion_via)}
            {order.actual_return_date ? ` — closed ${formatDate(order.actual_return_date)}` : ''}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
        <div className="px-3 py-2 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Input Materials <span className="text-xs font-normal text-gray-500">(Consumed)</span></h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Where each line&apos;s material went. Still at Vendor = Sent Out − Returned − Sold Direct − Transferred Out
            {hasOutputs ? ' (material converted into Output Materials stays counted here, same as the Stock Statement)' : ''}.
          </p>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Line ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item Code</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sent Out</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Returned</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sold Direct</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Transferred Out</th>
                {hasOutputs && <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Output Produced</th>}
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Still at Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => {
                const line = lineSummaries[item.id]
                return (
                <tr
                  key={item.id}
                  id={item.job_line_id ? `job-line-${item.job_line_id}` : undefined}
                  className="hover:bg-gray-50 scroll-mt-24 target:bg-amber-50"
                >
                  <td className="px-3 py-2 text-xs text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2 text-xs font-mono text-blue-700">
                    {item.purchase_line_id ? (
                      <Link
                        href={`/reports/purchase-line-ledger?line=${encodeURIComponent(item.purchase_line_id)}`}
                        title="Open Purchase Line Movements for this line"
                        className="hover:underline"
                      >
                        {item.purchase_line_id}
                      </Link>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-indigo-700">
                    {item.job_line_id ? (
                      outputAnchorByJobLine[item.job_line_id] ? (
                        <a
                          href={`#${outputAnchorByJobLine[item.job_line_id]}`}
                          title="Go to the Output Materials produced from this line"
                          className="hover:underline"
                        >
                          {item.job_line_id}
                        </a>
                      ) : (
                        <span title="No Output Materials recorded against this line yet">{item.job_line_id}</span>
                      )
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-700">
                    {itemLedgerHref(item.item_master_id) ? (
                      <Link href={itemLedgerHref(item.item_master_id)!} className="text-blue-600 hover:underline" title="Open this item's Stock Ledger">
                        {item.item_master?.item_code ?? '—'}
                      </Link>
                    ) : (item.item_master?.item_code ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">
                    {itemLedgerHref(item.item_master_id) ? (
                      <Link href={itemLedgerHref(item.item_master_id)!} className="text-gray-900 hover:text-blue-700 hover:underline" title="Open this item's Stock Ledger">
                        {item.item_name ?? item.material_types?.description ?? '—'}
                      </Link>
                    ) : (item.item_name ?? item.material_types?.description ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-900 text-right">
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
                  <td className="px-3 py-2 text-xs text-right text-emerald-700">{line && line.returned > 0.0005 ? fmt(line.returned) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-right text-amber-700">{line && line.soldDirect > 0.0005 ? fmt(line.soldDirect) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-right text-purple-700">{line && line.transferredOut > 0.0005 ? fmt(line.transferredOut) : <span className="text-gray-300">—</span>}</td>
                  {hasOutputs && (
                    <td className="px-3 py-2 text-xs text-gray-900 text-right">
                      {item.job_line_id ? getReturnedQuantity(item.job_line_id).toFixed(3) : '—'}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-xs font-semibold text-right ${line && line.atVendor < -0.0005 ? 'text-red-600' : 'text-gray-900'}`}>
                    {line?.missingLedger ? (
                      <span className="inline-flex items-center gap-1 text-red-600" title="This line has no stock ledger entries, so stock reports don't count it. Report it for a data check.">
                        <TriangleAlert className="h-3.5 w-3.5" /> No ledger entry
                      </span>
                    ) : (
                      <>{fmt(line?.atVendor ?? 0)} <span className="text-xs font-normal text-gray-400">{item.unit ?? 'MT'}</span></>
                    )}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
