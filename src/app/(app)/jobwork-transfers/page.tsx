export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFERS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'

export default async function JobWorkTransfersPage() {
  const result = await hasuraQuery(JOB_WORK_TRANSFERS_QUERY)
  const records = result.job_work_transfers ?? []

  const exportRows = records.flatMap((t: any) =>
    (t.job_work_transfer_items ?? []).map((it: any) => ({
      'Transfer No.': t.transfer_number || '',
      'Transfer Date': formatDate(t.transfer_date),
      'From Vendor': t.from_vendor?.name || '',
      'To Vendor': t.to_vendor?.name || '',
      'From Order': t.from_job_work_order?.reference_number || '',
      'To Order': t.to_job_work_order?.reference_number || '',
      'Purchase Line ID': it.purchase_line_id || '',
      'Item': it.item_name || '',
      'Qty Transferred': it.quantity_transferred ?? '',
      'Unit': it.unit || '',
      'Reason': t.reason || '',
    }))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Vendor Transfers</h1>
          <p className="mt-1 text-sm text-gray-500">Audit trail of pending job work handed from one vendor to another</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="jobwork-transfers" sheetName="Job Work Transfers" />}
          <Link href="/jobwork" className="text-sm text-blue-600 hover:underline">
            ← Job Work
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">⇄</p>
              <p className="text-gray-500">No vendor transfers yet.</p>
              <p className="text-sm text-gray-400 mt-1">Transfers appear here after you move pending job work to another vendor from an order's detail page.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Transfer No.</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Purchase Line</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.flatMap((t: any) => {
                  const items = t.job_work_transfer_items ?? []
                  const rowCount = Math.max(items.length, 1)
                  return (items.length > 0 ? items : [null]).map((it: any, idx: number) => (
                    <tr key={it?.id ?? t.id} className={`hover:bg-gray-50 align-top ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                      {idx === 0 && (
                        <>
                          <td className="px-2 py-2 font-mono text-xs text-purple-700 whitespace-nowrap" rowSpan={rowCount}>{t.transfer_number}</td>
                          <td className="px-2 py-2 text-gray-600 whitespace-nowrap" rowSpan={rowCount}>{formatDate(t.transfer_date)}</td>
                          <td className="px-2 py-2 whitespace-nowrap" rowSpan={rowCount}>
                            <span className="text-gray-700">{t.from_vendor?.name || '—'}</span>
                            {t.from_job_work_order && (
                              <Link href={`/jobwork/${t.from_job_work_order.id}`} className="block text-[10px] font-mono text-blue-600 hover:underline">
                                {t.from_job_work_order.reference_number}
                              </Link>
                            )}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap" rowSpan={rowCount}>
                            <span className="text-gray-700">{t.to_vendor?.name || '—'}</span>
                            {t.to_job_work_order && (
                              <Link href={`/jobwork/${t.to_job_work_order.id}`} className="block text-[10px] font-mono text-blue-600 hover:underline">
                                {t.to_job_work_order.reference_number}
                              </Link>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-2 py-2 font-mono text-xs text-blue-700 whitespace-nowrap">{it?.purchase_line_id || '—'}</td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{it?.item_name || '—'}</td>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{it?.size_label || '—'}</td>
                      <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">
                        {it ? `${Number(it.quantity_transferred).toFixed(3)} ${it.unit || ''}` : '—'}
                      </td>
                      {idx === 0 && (
                        <td className="px-2 py-2 text-gray-600" rowSpan={rowCount}>{t.reason || '—'}</td>
                      )}
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
