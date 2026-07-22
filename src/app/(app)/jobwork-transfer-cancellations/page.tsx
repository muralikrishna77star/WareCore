export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_TRANSFER_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'

export default async function JobWorkTransferCancellationsPage() {
  const result = await hasuraQuery(JOB_WORK_TRANSFER_CANCELLATIONS_QUERY)
  const records = result.job_work_transfer_cancellations ?? []

  const exportRows = records.map((r: any) => ({
    'Transfer No.': r.transfer_number || '',
    'Transfer Date': formatDate(r.transfer_date),
    'From Order': r.from_reference_number || '',
    'From Vendor': r.from_vendor_name || '',
    'To Order': r.to_reference_number || '',
    'To Vendor': r.to_vendor_name || '',
    'Reason': r.reason || '',
    'Cancelled': r.cancelled_at ? formatDate(r.cancelled_at) : '',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Transfer Deletions</h1>
          <p className="mt-1 text-sm text-gray-500">Archived deleted vendor transfers</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="jobwork-transfer-cancellations" sheetName="Transfer Deletions" />}
          <Link href="/jobwork-transfers" className="text-sm text-blue-600 hover:underline">
            ← Vendor Transfers
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🗑</p>
              <p className="text-gray-500">No deleted vendor transfers yet.</p>
              <p className="text-sm text-gray-400 mt-1">Deleted transfers appear here after you delete one from the Vendor Transfers list.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Transfer No.</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Transfer Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">From Order / Vendor</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">To Order / Vendor</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Cancelled</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-xs text-gray-500 line-through whitespace-nowrap">{r.transfer_number || '—'}</td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.transfer_date)}</td>
                    <td className="px-6 py-3 text-gray-700">
                      {r.from_reference_number || '—'}
                      {r.from_vendor_name ? <span className="text-gray-400"> — {r.from_vendor_name}</span> : null}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {r.to_reference_number || '—'}
                      {r.to_vendor_name ? <span className="text-gray-400"> — {r.to_vendor_name}</span> : null}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
                    <td className="px-6 py-3">
                      <Link href={`/jobwork-transfer-cancellations/${r.id}`}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium whitespace-nowrap">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
