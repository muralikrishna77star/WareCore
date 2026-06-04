export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_BILLS_QUERY } from '@/lib/hasura/queries'

export default async function BillsPage() {
  const result = await hasuraQuery(PURCHASE_BILLS_QUERY)
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

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {!bills || bills.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-[1.1875rem] mb-3">📋</p>
              <p className="text-gray-500">No purchase bills yet.</p>
              <Link href="/bills/new" className="mt-4 inline-block text-blue-600 hover:underline text-[0.9375rem]">
                Create your first bill →
              </Link>
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <thead>
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
                {bills.map((bill: any) => {
                  const cancelled = bill.status === 'cancelled'
                  return (
                  <tr key={bill.id} className={`hover:bg-gray-50 ${cancelled ? 'opacity-60' : ''}`}>
                    <td className={`px-6 py-3 font-medium whitespace-nowrap ${cancelled ? 'text-gray-400 line-through' : 'text-blue-600'}`}>
                      {bill.bill_number}
                    </td>
                    <td className="px-6 py-3 text-gray-700 whitespace-nowrap">
                      {formatDate(bill.bill_date)}
                    </td>
                    <td className="px-6 py-3 text-gray-700">
                      {bill.suppliers?.name || '-'}
                    </td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-blue-700">
                        {bill.companies?.code}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">
                      {bill.warehouses?.name || '-'}
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-700">
                      {Number(bill.total_quantity || 0).toFixed(3)}
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-700">
                      ₹{Number(bill.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-3">
                      {cancelled ? (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[0.6875rem] font-medium text-red-600 border border-red-200">
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[0.6875rem] font-medium text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/bills/${bill.id}`}
                        className="text-blue-600 hover:text-blue-800 text-[0.6875rem] font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
