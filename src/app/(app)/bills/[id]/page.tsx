export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate, formatCurrency } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_BILL_BY_ID_QUERY, PURCHASE_BILL_ITEMS_QUERY, USER_PROFILE_BY_ID_QUERY } from '@/lib/hasura/queries'
import CancelBillButton from './CancelBillButton'
import SubmitBillButton from './SubmitBillButton'
import PurgeBillButton from './PurgeBillButton'

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [billResult, itemsResult] = await Promise.all([
    hasuraQuery(PURCHASE_BILL_BY_ID_QUERY, { id }),
    hasuraQuery(PURCHASE_BILL_ITEMS_QUERY, { bill_id: id }),
  ])
  const bill = billResult.purchase_bills_by_pk
  if (!bill) notFound()
  const items = itemsResult.purchase_bill_items ?? []

  let createdByName: string | null = null
  if (bill.created_by) {
    const creatorResult = await hasuraQuery(USER_PROFILE_BY_ID_QUERY, { id: bill.created_by }, { suppressError: true })
    createdByName = creatorResult.user_profiles_by_pk?.full_name ?? null
  }

  const totalAmount = items.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0)
  const totalQty = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0)

  const isCancelled = bill.status === 'cancelled'
  const isDraft = bill.status === 'draft'

  // Check if any purchase line IDs from this bill are used in an active sale entry
  let canCancel = true
  let dispatchedLineCount = 0
  if (!isCancelled) {
    const purchaseLineIds = items
      .map((i: any) => i.purchase_line_id)
      .filter(Boolean) as string[]

    if (purchaseLineIds.length > 0) {
      const usageResult = await hasuraQuery(
        `query CheckBillLinesInDispatch($line_ids: [String!]!) {
          dispatch_items_aggregate(where: {
            purchase_line_id: { _in: $line_ids }
            dispatch_order: { status: { _eq: "active" } }
          }) { aggregate { count } }
        }`,
        { line_ids: purchaseLineIds }
      )
      dispatchedLineCount = Number(usageResult.dispatch_items_aggregate?.aggregate?.count ?? 0)
      canCancel = dispatchedLineCount === 0
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/bills" className="text-[0.9375rem] text-blue-600 hover:underline mb-1 block">
            ← Back to Bills
          </Link>
          <h1 className={`text-[1.4375rem] font-bold ${isCancelled ? 'text-gray-400' : 'text-gray-900'}`}>
            Bill #{bill.bill_number}
          </h1>
        </div>
        {isCancelled ? (
          <span className="px-3 py-1 rounded-full text-[0.9375rem] font-semibold bg-red-100 text-red-700 border border-red-200">
            Cancelled
          </span>
        ) : isDraft ? (
          <span className="px-3 py-1 rounded-full text-[0.9375rem] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
            Draft
          </span>
        ) : (
          <span className="px-3 py-1 rounded-full text-[0.9375rem] font-medium bg-green-100 text-green-800">
            Purchase Bill
          </span>
        )}
      </div>

      {/* Cancellation notice */}
      {isCancelled && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-[0.9375rem] font-semibold text-red-700 mb-1">
            This bill was cancelled on {formatDate(bill.cancelled_at)}
          </p>
          {bill.cancelled_notes && (
            <p className="text-[0.9375rem] text-red-600">Reason: {bill.cancelled_notes}</p>
          )}
          <p className="text-[0.6875rem] text-red-500 mt-2">
            All stock movements from this bill have been reversed in the stock ledger.
          </p>
        </div>
      )}

      {/* Cannot-cancel notice */}
      {!isCancelled && !canCancel && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-[0.9375rem] font-semibold text-amber-800 mb-1">Cannot Cancel</p>
          <p className="text-[0.9375rem] text-amber-700">
            {dispatchedLineCount} line item{dispatchedLineCount !== 1 ? 's have' : ' has'} been
            dispatched in an active sale entry. Cancel the related sale entries first, then cancel this bill.
          </p>
        </div>
      )}

      {/* Bill Info */}
      <div className={`bg-white rounded-xl border border-gray-200 p-6 mb-6 ${isCancelled ? 'opacity-60' : ''}`}>
        <h2 className="text-[1.0625rem] font-semibold text-gray-900 mb-4">Bill Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Bill Number</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{bill.bill_number}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Date</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{formatDate(bill.bill_date)}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Supplier</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{bill.suppliers?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{bill.companies?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Warehouse</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{bill.warehouses?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Created On</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{formatDate(bill.created_at)}</p>
          </div>
          <div>
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide">Created By</p>
            <p className="text-[0.8125rem] font-medium text-gray-900 mt-1">{createdByName ?? '—'}</p>
          </div>
        </div>
        {bill.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-[0.6875rem] text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-[0.8125rem] text-gray-700">{bill.notes}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden mb-6 ${isCancelled ? 'opacity-60' : ''}`}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-[1.1875rem] font-semibold text-gray-900">Line Items</h2>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Line ID</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-6 py-3 text-left text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Rate (₹)</th>
                <th className="px-6 py-3 text-right text-[0.6875rem] font-medium text-gray-500 uppercase tracking-wider">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[0.9375rem] text-gray-400">
                    No line items recorded.
                  </td>
                </tr>
              ) : items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-[0.9375rem] font-mono text-blue-700">
                    {item.purchase_line_id ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-[0.9375rem] font-medium text-gray-900">
                    {item.item_name ?? item.material_types?.name ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-700">
                    {item.size_label ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-900 text-right">
                    {Number(item.quantity).toFixed(3)}
                    <span className="ml-1 text-xs text-gray-400">{item.unit ?? 'MT'}</span>
                  </td>
                  <td className="px-6 py-4 text-[0.9375rem] text-gray-900 text-right">
                    {item.rate ? formatCurrency(Number(item.rate)) : '—'}
                  </td>
                  <td className="px-6 py-4 text-[0.9375rem] font-medium text-gray-900 text-right">
                    {item.amount ? formatCurrency(Number(item.amount)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={4} className="px-6 py-4 text-[0.9375rem] font-semibold text-gray-900 text-right">Totals</td>
                <td className="px-6 py-4 text-[0.9375rem] font-bold text-gray-900 text-right">{totalQty.toFixed(3)} MT</td>
                <td></td>
                <td className="px-6 py-4 text-[0.9375rem] font-bold text-blue-700 text-right">{formatCurrency(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap items-center">
        {isDraft ? (
          <>
            <Link
              href={`/bills/${bill.id}/edit`}
              className="px-4 py-2 bg-blue-600 text-white text-[0.9375rem] font-medium rounded-lg hover:bg-blue-700"
            >
              Edit Draft
            </Link>
            <SubmitBillButton billId={bill.id} hasWarehouse={!!bill.warehouses} />
          </>
        ) : !isCancelled ? (
          <>
            <Link
              href={`/bills/${bill.id}/edit`}
              className="px-4 py-2 bg-blue-600 text-white text-[0.9375rem] font-medium rounded-lg hover:bg-blue-700"
            >
              Edit Bill
            </Link>
            <Link
              href="/bills/new"
              className="px-4 py-2 bg-white text-gray-700 text-[0.9375rem] font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              New Bill
            </Link>
          </>
        ) : (
          <Link
            href="/bills/new"
            className="px-4 py-2 bg-blue-600 text-white text-[0.9375rem] font-medium rounded-lg hover:bg-blue-700"
          >
            New Bill
          </Link>
        )}
        <Link
          href="/bills"
          className="px-4 py-2 bg-white text-gray-700 text-[0.9375rem] font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          All Bills
        </Link>
        {!isCancelled && canCancel && <CancelBillButton billId={bill.id} />}
        {isCancelled && <PurgeBillButton billId={bill.id} />}
      </div>
    </div>
  )
}
