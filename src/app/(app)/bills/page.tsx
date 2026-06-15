export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_BILLS_QUERY } from '@/lib/hasura/queries'
import BillRow from './BillRow'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ line_id?: string }>
}) {
  const params = await searchParams
  const lineId = params.line_id?.trim() || ''

  const where = lineId
    ? { purchase_bill_items: { purchase_line_id: { _ilike: `%${lineId}%` } } }
    : {}

  const result = await hasuraQuery(PURCHASE_BILLS_QUERY, { where })
  const bills = result.purchase_bills ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Purchase Bills</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">All inward purchase bills</p>
        </div>
        <Link
          href="/bills/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Bill
        </Link>
      </div>

      <form className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">Purchase Line ID</label>
            <input
              type="text"
              name="line_id"
              defaultValue={lineId}
              placeholder="e.g. CR0426-0001"
              className="rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] w-56"
            />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-[0.9375rem] font-medium text-white hover:bg-blue-700">
            Search
          </button>
          {lineId && (
            <Link href="/bills" className="text-[0.9375rem] text-gray-500 hover:underline">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!bills || bills.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-[1.1875rem] mb-3">📋</p>
              {lineId ? (
                <p className="text-gray-500">No purchase bills found with a line item matching &quot;{lineId}&quot;.</p>
              ) : (
                <>
                  <p className="text-gray-500">No purchase bills yet.</p>
                  <Link href="/bills/new" className="mt-4 inline-block text-blue-600 hover:underline text-[0.9375rem]">
                    Create your first bill →
                  </Link>
                </>
              )}
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Bill No.</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Supplier</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase text-right">Quantity</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase text-right">Amount</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.map((bill: any) => (
                  <BillRow key={bill.id} bill={bill} highlight={lineId} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
