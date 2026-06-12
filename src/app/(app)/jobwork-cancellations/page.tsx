export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { JOB_WORK_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'

export default async function JobWorkCancellationsPage() {
  const result = await hasuraQuery(JOB_WORK_CANCELLATIONS_QUERY)
  const records = result.job_work_cancellations ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Work Cancellations</h1>
          <p className="mt-1 text-sm text-gray-500">Archived cancelled job work orders</p>
        </div>
        <Link href="/jobwork" className="text-sm text-blue-600 hover:underline">
          ← Job Work
        </Link>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🗑</p>
              <p className="text-gray-500">No cancelled job work orders yet.</p>
              <p className="text-sm text-gray-400 mt-1">Cancelled job work orders appear here after you delete them from the job work detail page.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Reference No.</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Dispatch Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status at Cancellation</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Cancelled</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-xs text-gray-500 line-through whitespace-nowrap">{r.reference_number || '—'}</td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.dispatch_date)}</td>
                    <td className="px-6 py-3 text-gray-700">{r.vendor_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize bg-gray-100 text-gray-700">
                        {r.status?.replace('_', ' ') || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-xs whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
                    <td className="px-6 py-3">
                      <Link href={`/jobwork-cancellations/${r.id}`}
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
