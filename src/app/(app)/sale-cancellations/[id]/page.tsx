export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate, formatCurrency } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_CANCELLATION_BY_ID_QUERY } from '@/lib/hasura/queries'

export default async function SaleCancellationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await hasuraQuery(DISPATCH_CANCELLATION_BY_ID_QUERY, { id })
  const record = result.dispatch_cancellations_by_pk
  if (!record) notFound()

  const items = record.dispatch_cancellation_items ?? []
  const totalQty = items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0)
  const totalAmt = items.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/sale-cancellations" className="text-[0.9375rem] text-blue-600 hover:underline mb-1 block">
            ← Sale Cancellations
          </Link>
          <h1 className="text-[1.4375rem] font-bold text-gray-400 line-through">
            {record.invoice_number ? `Invoice ${record.invoice_number}` : `Sale ${id.slice(0, 8)}`}
          </h1>
        </div>
        <span className="px-3 py-1 rounded-full text-[0.9375rem] font-semibold bg-gray-100 text-gray-600 border border-gray-300">
          Purged
        </span>
      </div>

      {/* Order Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 opacity-80">
        <h2 className="text-[1.0625rem] font-semibold text-gray-900 mb-4">Sale Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Invoice Number</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1 line-through">{record.invoice_number || '—'}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{formatDate(record.dispatch_date)}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{record.customer_name ?? '—'}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{record.company_name ?? '—'}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Warehouse</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{record.warehouse_name ?? '—'}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Vehicle</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{record.vehicle_number ?? '—'}</p></div>
          {record.sale_ref_id && (
            <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Sale Ref ID</p>
              <p className="text-[0.8125rem] font-medium text-gray-700 mt-1 font-mono">{record.sale_ref_id}</p></div>
          )}
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Cancelled On</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{record.cancelled_at ? formatDate(record.cancelled_at) : '—'}</p></div>
          <div><p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Purged On</p>
            <p className="text-[0.8125rem] font-medium text-gray-700 mt-1">{formatDate(record.purged_at)}</p></div>
          {record.cancelled_notes && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Cancellation Reason</p>
              <p className="text-[0.8125rem] text-gray-700 mt-1">{record.cancelled_notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 opacity-80">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-[1.1875rem] font-semibold text-gray-900">Dispatched Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase">#</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase">Item</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase">Material</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase">Size</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase">Rate</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No line items.</td></tr>
              ) : items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-[0.9375rem] font-medium text-gray-700">{item.item_name || '—'}</td>
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-600">{item.material_type_name || '—'}</td>
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-600">{item.size_label || '—'}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{Number(item.quantity).toFixed(3)}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{item.rate ? formatCurrency(Number(item.rate)) : '—'}</td>
                  <td className="px-6 py-4 text-right font-medium text-gray-700">{item.amount ? formatCurrency(Number(item.amount)) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={4} className="px-6 py-4 text-[0.9375rem] font-semibold text-gray-900 text-right">Totals</td>
                <td className="px-6 py-4 text-right font-bold text-gray-700">{totalQty.toFixed(3)}</td>
                <td></td>
                <td className="px-6 py-4 text-right font-bold text-blue-700">{formatCurrency(totalAmt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Link href="/sale-cancellations"
        className="px-4 py-2 bg-white text-gray-700 text-[0.9375rem] font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
        ← Back to Cancellations
      </Link>
    </div>
  )
}
