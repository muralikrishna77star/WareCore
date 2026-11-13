export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, PackageOpen } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { SALE_RETURNS_LIST_QUERY } from '@/lib/hasura/queries'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ListingSummary } from '@/components/ListingSummary'

interface SaleReturnRow {
  id: string
  return_number: string
  dispatch_order_id: string | null
  invoice_number: string
  return_date: string
  reason: string | null
  status: string
  total_quantity: number | string
  total_amount: number | string
  cancelled_at: string | null
  companies?: { name: string | null } | null
  warehouses?: { name: string | null } | null
  customers?: { name: string | null } | null
}

export default async function SaleReturnsPage() {
  const result = await hasuraQuery(SALE_RETURNS_LIST_QUERY)
  const records: SaleReturnRow[] = result.sale_returns ?? []
  const active = records.filter((r) => r.status === 'active')

  const exportRows = records.map((r) => ({
    'Return No.': r.return_number,
    'Return Date': formatDate(r.return_date),
    'Sale Invoice': r.invoice_number,
    'Customer': r.customers?.name ?? '',
    'Company': r.companies?.name ?? '',
    'Warehouse': r.warehouses?.name ?? '',
    'Qty': Number(r.total_quantity || 0),
    'Amount': Number(r.total_amount || 0),
    'Reason': r.reason ?? '',
    'Status': r.status === 'active' ? 'Active' : 'Cancelled',
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Sales Returns</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">
            Goods returned by customers. To record one, open the sale and choose <span className="font-medium">Record Customer Return</span>.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {records.length > 0 && <ExportExcelButton rows={exportRows} filename="sales-returns" sheetName="Sales Returns" />}
          <Link href="/dispatch" className="text-[0.9375rem] text-blue-600 hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4 shrink-0" /> Sale Entry
          </Link>
        </div>
      </div>

      {active.length > 0 && (
        <ListingSummary
          count={active.length}
          countLabel="active return"
          countIcon={PackageOpen}
          totalQuantity={active.reduce((s, r) => s + Number(r.total_quantity || 0), 0)}
          totalAmount={active.reduce((s, r) => s + Number(r.total_amount || 0), 0)}
        />
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {records.length === 0 ? (
            <div className="p-12 text-center">
              <PackageOpen className="mx-auto h-10 w-10 text-gray-400 mb-3" />
              <p className="text-gray-500">No customer returns yet.</p>
            </div>
          ) : (
            <table className="w-full text-[0.9375rem]">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {['Return No.', 'Return Date', 'Sale Invoice', 'Customer', 'Warehouse', 'Qty (MT)', 'Amount', 'Reason', 'Status'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider ${i === 5 || i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => {
                  const cancelled = r.status !== 'active'
                  return (
                    <tr key={r.id} className={`hover:bg-gray-50 ${cancelled ? 'text-gray-400' : ''}`}>
                      <td className="px-3 py-2 font-mono text-[0.8125rem]">
                        <Link href={`/sale-returns/${r.id}`} className="text-blue-700 hover:underline">{r.return_number}</Link>
                      </td>
                      <td className="px-3 py-2 text-[0.8125rem]">{formatDate(r.return_date)}</td>
                      <td className="px-3 py-2 font-mono text-[0.8125rem]">
                        {r.dispatch_order_id
                          ? <Link href={`/dispatch/${r.dispatch_order_id}`} className="text-blue-700 hover:underline">{r.invoice_number}</Link>
                          : r.invoice_number}
                      </td>
                      <td className="px-3 py-2 text-[0.8125rem]">{r.customers?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-[0.8125rem]">{r.warehouses?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-[0.8125rem] text-right">{Number(r.total_quantity || 0).toFixed(3)}</td>
                      <td className="px-3 py-2 text-[0.8125rem] text-right">{Number(r.total_amount) ? formatCurrency(Number(r.total_amount)) : '—'}</td>
                      <td className="px-3 py-2 text-[0.8125rem]">{r.reason ?? '—'}</td>
                      <td className="px-3 py-2 text-[0.8125rem]">
                        {cancelled
                          ? <span className="px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600 border border-red-200">Cancelled</span>
                          : <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 border border-green-200">Active</span>}
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
