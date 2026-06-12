export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'

export default async function SaleCancellationsPage() {
  const result = await hasuraQuery(DISPATCH_CANCELLATIONS_QUERY)
  const records = result.dispatch_cancellations ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Sale Cancellations</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">Archived cancelled sale / dispatch orders</p>
        </div>
        <Link href="/dispatch" className="text-[0.9375rem] text-blue-600 hover:underline">
          ← Sale Entry
        </Link>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-[1.1875rem] mb-3">🗑</p>
              <p className="text-gray-500">No purged sales yet.</p>
              <p className="text-[0.8125rem] text-gray-400 mt-1">Cancelled sales appear here after you purge them from the sale detail page.</p>
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Invoice No.</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Dispatch Date</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase text-right">Qty</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase text-right">Amount</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Cancelled</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Purged</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-[0.8125rem] text-gray-500 line-through whitespace-nowrap">{r.invoice_number || '—'}</td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.dispatch_date)}</td>
                    <td className="px-6 py-3 text-gray-700">{r.customer_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{Number(r.total_quantity || 0).toFixed(3)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {r.total_amount ? `₹${Number(r.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
                    <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{formatDate(r.purged_at)}</td>
                    <td className="px-6 py-3">
                      <Link href={`/sale-cancellations/${r.id}`}
                        className="text-blue-600 hover:text-blue-800 text-[0.6875rem] font-medium whitespace-nowrap">
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
