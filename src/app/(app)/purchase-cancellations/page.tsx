export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_CANCELLATIONS_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'

export default async function PurchaseCancellationsPage() {
  const result = await hasuraQuery(PURCHASE_CANCELLATIONS_QUERY)
  const records = result.purchase_cancellations ?? []

  const exportRows = records.map((r: any) => ({
    'Bill No.': r.bill_number,
    'Bill Date': formatDate(r.bill_date),
    'Supplier': r.supplier_name || '',
    'Company': r.company_name || '',
    'Warehouse': r.warehouse_name || '',
    'Qty': Number(r.total_quantity || 0),
    'Amount': Number(r.total_amount || 0),
    'Cancelled': r.cancelled_at ? formatDate(r.cancelled_at) : '',
    'Purged': formatDate(r.purged_at),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Purchase Cancellations</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">Archived cancelled purchase bills</p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="purchase-cancellations" sheetName="Purchase Cancellations" />}
          <Link href="/bills" className="text-[0.9375rem] text-blue-600 hover:underline">
            ← Purchase Bills
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-[1.1875rem] mb-3">🗑</p>
              <p className="text-gray-500">No purged cancellations yet.</p>
              <p className="text-[0.8125rem] text-gray-400 mt-1">Cancelled bills appear here after you purge them from the bill detail page.</p>
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Bill No.</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Bill Date</th>
                  <th className="px-6 py-3 text-[0.6875rem] font-medium text-gray-500 uppercase">Supplier</th>
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
                    <td className="px-6 py-3 font-mono text-[0.8125rem] text-gray-500 line-through whitespace-nowrap">{r.bill_number}</td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(r.bill_date)}</td>
                    <td className="px-6 py-3 text-gray-700">{r.supplier_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-700">{r.company_name || '—'}</td>
                    <td className="px-6 py-3 text-gray-600">{r.warehouse_name || '—'}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{Number(r.total_quantity || 0).toFixed(3)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      ₹{Number(r.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{r.cancelled_at ? formatDate(r.cancelled_at) : '—'}</td>
                    <td className="px-6 py-3 text-gray-500 text-[0.8125rem] whitespace-nowrap">{formatDate(r.purged_at)}</td>
                    <td className="px-6 py-3">
                      <Link href={`/purchase-cancellations/${r.id}`}
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
