export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { SALE_RETURN_BY_ID_QUERY, USER_PROFILE_BY_ID_QUERY } from '@/lib/hasura/queries'
import { ItemLedgerLink, PurchaseLineLink } from '@/components/ReportLinks'
import CancelSaleReturnButton from './CancelSaleReturnButton'

interface SaleReturnItem {
  id: string
  item_master_id: string | null
  item_name: string | null
  sale_line_id: string | null
  purchase_line_id: string | null
  size_label: string | null
  quantity: number | string
  rate: number | string | null
  amount: number | string | null
  total_with_tax: number | string | null
  notes: string | null
  material_types?: { description: string | null } | null
  item_master?: { item_code: string | null } | null
}

async function userName(id: string | null) {
  if (!id) return null
  const r = await hasuraQuery(USER_PROFILE_BY_ID_QUERY, { id }, { suppressError: true }).catch(() => null)
  return r?.user_profiles_by_pk?.full_name ?? null
}

export default async function SaleReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await hasuraQuery(SALE_RETURN_BY_ID_QUERY, { id })
  const ret = result.sale_returns_by_pk
  if (!ret) notFound()
  const items: SaleReturnItem[] = ret.sale_return_items ?? []
  const [createdByName, cancelledByName] = await Promise.all([userName(ret.created_by), userName(ret.cancelled_by)])

  const isCancelled = ret.status !== 'active'
  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const totalAmount = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const totalWithTax = items.reduce((s, i) => s + (Number(i.total_with_tax) || 0), 0)

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="text-sm font-medium text-gray-900 mt-1">{value}</div>
    </div>
  )

  return (
    <div className="w-full max-w-[1920px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <Link href="/sale-returns" className="text-sm text-blue-600 hover:underline mb-1 inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4 shrink-0" /> All Sales Returns
          </Link>
          <h1 className={`text-2xl font-bold ${isCancelled ? 'text-gray-400' : 'text-gray-900'}`}>
            Sales Return: {ret.return_number}
          </h1>
        </div>
        {isCancelled ? (
          <span className="px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 border border-red-200">Cancelled</span>
        ) : (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">Active</span>
        )}
      </div>

      {isCancelled && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-700 mb-1">
            This return was cancelled on {formatDate(ret.cancelled_at)}{cancelledByName ? ` by ${cancelledByName}` : ''}
          </p>
          {ret.cancelled_notes && <p className="text-sm text-red-600">Reason: {ret.cancelled_notes}</p>}
          <p className="text-xs text-red-500 mt-2">The stock this return added back has been removed again.</p>
        </div>
      )}

      <div className={`bg-white rounded-xl border border-gray-200 p-4 mb-4 ${isCancelled ? 'opacity-60' : ''}`}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Return Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {field('Return Date', formatDate(ret.return_date))}
          {field('Sale Invoice', ret.dispatch_order_id
            ? <Link href={`/dispatch/${ret.dispatch_order_id}`} className="font-mono text-blue-700 hover:underline">{ret.invoice_number}</Link>
            : <span className="font-mono">{ret.invoice_number}</span>)}
          {field('Customer', ret.customers?.name ?? '—')}
          {field('Company', ret.companies?.name ?? '—')}
          {field('Returned To', ret.warehouses?.name ?? '—')}
          {field('Reason', ret.reason ?? '—')}
          {field('Created On', formatDateTime(ret.created_at))}
          {field('Created By', createdByName ?? '—')}
        </div>
        {ret.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{ret.notes}</p>
          </div>
        )}
      </div>

      <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden mb-4 ${isCancelled ? 'opacity-60' : ''}`}>
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Returned Items</h2>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                {['#', 'Item Code', 'Item Name', 'Material', 'Purchase Line', 'Size', 'Qty Returned (MT)', 'Rate (₹/MT)', 'Amount (₹)', 'With Tax (₹)'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider ${i >= 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2 text-[0.8125rem] font-mono text-gray-700">
                    <ItemLedgerLink itemMasterId={item.item_master_id} fromDate={ret.return_date}>{item.item_master?.item_code ?? '—'}</ItemLedgerLink>
                  </td>
                  <td className="px-3 py-2 text-[0.8125rem] font-medium text-gray-900">
                    {item.item_name ?? '—'}
                    {item.sale_line_id && (
                      <span className="block text-[10px] font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1 mt-0.5 w-fit">{item.sale_line_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-700">{item.material_types?.description ?? '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] font-mono text-blue-700">
                    <PurchaseLineLink lineId={item.purchase_line_id} className="text-blue-700 hover:underline" />
                  </td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-700">{item.size_label ?? '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-900 text-right">{Number(item.quantity).toFixed(3)}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-900 text-right">{item.rate ? formatCurrency(Number(item.rate)) : '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-900 text-right">{item.amount ? formatCurrency(Number(item.amount)) : '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-900 text-right">{item.total_with_tax ? formatCurrency(Number(item.total_with_tax)) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={6} className="px-3 py-2 text-[0.8125rem] font-semibold text-gray-900 text-right">Totals</td>
                <td className="px-3 py-2 text-[0.8125rem] font-bold text-gray-900 text-right">{totalQty.toFixed(3)} MT</td>
                <td></td>
                <td className="px-3 py-2 text-[0.8125rem] font-bold text-blue-700 text-right">{formatCurrency(totalAmount)}</td>
                <td className="px-3 py-2 text-[0.8125rem] font-bold text-blue-700 text-right">{totalWithTax ? formatCurrency(totalWithTax) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        {ret.dispatch_order_id && (
          <Link href={`/dispatch/${ret.dispatch_order_id}`} className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
            View Sale
          </Link>
        )}
        <Link href="/sale-returns" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Sales Returns
        </Link>
        {!isCancelled && <CancelSaleReturnButton returnId={ret.id} returnNumber={ret.return_number} />}
      </div>
    </div>
  )
}
