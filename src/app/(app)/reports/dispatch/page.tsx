export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_REPORT_QUERY, ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default async function DispatchReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; warehouse?: string; status?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { dispatch_date: { _gte: fromDate } },
    { dispatch_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (params.status) conditions.push({ status: { _eq: params.status } })

  const [result, compResult, whResult] = await Promise.all([
    hasuraQuery(DISPATCH_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])

  const orders: any[] = result.dispatch_orders ?? []
  const companies: any[] = compResult.companies ?? []
  const allWarehouses: any[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w: any) => w.company_id === params.company)
    : allWarehouses

  const totalQty = orders.reduce((s, o) => {
    return s + (o.dispatch_items ?? []).reduce((si: number, i: any) => si + Number(i.quantity || 0), 0)
  }, 0)
  const totalAmt = orders.reduce((s, o) => {
    return s + (o.dispatch_items ?? []).reduce((si: number, i: any) => si + Number(i.amount || 0), 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispatch Report</h1>
          <p className="text-sm text-gray-500 mt-1">Goods dispatched to customers</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Dispatch Report</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
            <select name="warehouse" defaultValue={params.warehouse || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Warehouses</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select name="status" defaultValue={params.status || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="dispatched">Dispatched</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" name="from" defaultValue={fromDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" name="to" defaultValue={toDate} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Apply</button>
        </div>
      </form>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-orange-50 p-4">
          <p className="text-xs text-gray-500">Total Orders</p>
          <p className="text-xl font-bold text-orange-800">{orders.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 p-4">
          <p className="text-xs text-gray-500">Total Quantity</p>
          <p className="text-xl font-bold text-blue-800">{totalQty.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total Amount</p>
          <p className="text-xl font-bold text-green-800">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{orders.length} dispatch order{orders.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          {orders.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No dispatch orders found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Invoice No.</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Warehouse</th>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-left">Material</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Qty (T)</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">Amount (₹)</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o: any) => {
                  const items = o.dispatch_items ?? []
                  const rows = items.length === 0 ? [null] : items
                  return rows.map((item: any, idx: number) => (
                    <tr key={`${o.id}-${idx}`} className="hover:bg-gray-50">
                      {idx === 0 && (
                        <>
                          <td className="px-4 py-3 text-gray-600" rowSpan={rows.length}>{formatDate(o.dispatch_date)}</td>
                          <td className="px-4 py-3 font-medium text-orange-700" rowSpan={rows.length}>{o.invoice_number ?? '—'}</td>
                          <td className="px-4 py-3" rowSpan={rows.length}>{o.companies?.name}</td>
                          <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{o.warehouses?.name}</td>
                          <td className="px-4 py-3" rowSpan={rows.length}>{o.customers?.name}</td>
                          <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{o.vehicle_number ?? '—'}</td>
                        </>
                      )}
                      {item ? (
                        <>
                          <td className="px-4 py-3 font-medium">{item.material_types?.name}</td>
                          <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                          <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
                          <td className="px-4 py-3 text-right">{item.rate ? `₹${Number(item.rate).toLocaleString('en-IN')}` : '—'}</td>
                          <td className="px-4 py-3 text-right">{item.amount ? `₹${Number(item.amount).toLocaleString('en-IN')}` : '—'}</td>
                        </>
                      ) : (
                        <td className="px-4 py-3 text-gray-400" colSpan={5}>No items</td>
                      )}
                      {idx === 0 && (
                        <td className="px-4 py-3" rowSpan={rows.length}>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[o.status] ?? 'bg-gray-100 text-gray-700'}`}>
                            {o.status?.replace(/_/g, ' ')}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={8}>Total</td>
                  <td className="px-4 py-3 text-right">{totalQty.toFixed(3)}</td>
                  <td />
                  <td className="px-4 py-3 text-right">₹{totalAmt.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
