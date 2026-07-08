export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { TRANSFERS_REPORT_QUERY, ACTIVE_COMPANIES_QUERY } from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default async function TransfersReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; status?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { transfer_date: { _gte: fromDate } },
    { transfer_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ _or: [{ from_company_id: { _eq: params.company } }, { to_company_id: { _eq: params.company } }] })
  if (params.status) conditions.push({ status: { _eq: params.status } })

  const [result, compResult] = await Promise.all([
    hasuraQuery(TRANSFERS_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
  ])

  const transfers: any[] = result.transfers ?? []
  const companies: any[] = compResult.companies ?? []

  const totalQty = transfers.reduce((s, t) => {
    return s + (t.transfer_items ?? []).reduce((si: number, i: any) => si + Number(i.quantity || 0), 0)
  }, 0)

  const exportRows = transfers.flatMap((t: any) => {
    const items = t.transfer_items ?? []
    const base = {
      'Date': formatDate(t.transfer_date),
      'From Company': t.companies_from?.name || '',
      'From Warehouse': t.warehouses_from?.name || '',
      'To Company': t.companies_to?.name || '',
      'To Warehouse': t.warehouses_to?.name || '',
    }
    const status = t.status?.replace('_', ' ') ?? ''
    if (items.length === 0) {
      return [{ ...base, 'Material': '', 'Size': '', 'Qty (T)': '', 'Status': status }]
    }
    return items.map((item: any) => ({
      ...base,
      'Material': item.material_types?.description || '',
      'Size': item.material_sizes?.size_label ?? item.size_label ?? '',
      'Qty (T)': Number(item.quantity),
      'Status': status,
    }))
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transfers Report</h1>
          <p className="text-sm text-gray-500 mt-1">Inter-company and inter-warehouse transfers</p>
        </div>
        <div className="flex items-center gap-2">
          {transfers.length > 0 && (
            <ExportExcelButton rows={exportRows} filename={`transfers-report-${fromDate}-to-${toDate}`} sheetName="Transfers" />
          )}
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Transfers Report</h1>
        <p className="text-sm text-gray-600">{fromDate} to {toDate}</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4 print:hidden">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company (From or To)</label>
            <select name="company" defaultValue={params.company || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Companies</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select name="status" defaultValue={params.status || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="in_transit">In Transit</option>
              <option value="completed">Completed</option>
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
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border bg-indigo-50 p-4">
          <p className="text-xs text-gray-500">Total Transfers</p>
          <p className="text-xl font-bold text-indigo-800">{transfers.length}</p>
        </div>
        <div className="rounded-xl border bg-blue-50 p-4">
          <p className="text-xs text-gray-500">Total Quantity Moved</p>
          <p className="text-xl font-bold text-blue-800">{totalQty.toFixed(3)} T</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{transfers.length} transfer{transfers.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          {transfers.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No transfers found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">From Company</th>
                  <th className="px-4 py-3 text-left">From Warehouse</th>
                  <th className="px-4 py-3 text-left">To Company</th>
                  <th className="px-4 py-3 text-left">To Warehouse</th>
                  <th className="px-4 py-3 text-left">Material</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Qty (T)</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map((t: any) => {
                  const items = t.transfer_items ?? []
                  const rows = items.length === 0 ? [null] : items
                  return rows.map((item: any, idx: number) => (
                    <tr key={`${t.id}-${idx}`} className="hover:bg-gray-50">
                      {idx === 0 && (
                        <>
                          <td className="px-4 py-3 text-gray-600" rowSpan={rows.length}>{formatDate(t.transfer_date)}</td>
                          <td className="px-4 py-3" rowSpan={rows.length}>{t.companies_from?.name}</td>
                          <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{t.warehouses_from?.name}</td>
                          <td className="px-4 py-3" rowSpan={rows.length}>{t.companies_to?.name}</td>
                          <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{t.warehouses_to?.name}</td>
                        </>
                      )}
                      {item ? (
                        <>
                          <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
                          <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                          <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
                        </>
                      ) : (
                        <td className="px-4 py-3 text-gray-400" colSpan={3}>No items</td>
                      )}
                      {idx === 0 && (
                        <td className="px-4 py-3" rowSpan={rows.length}>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[t.status] ?? 'bg-gray-100 text-gray-700'}`}>
                            {t.status?.replace('_', ' ')}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={7}>Total</td>
                  <td className="px-4 py-3 text-right">{totalQty.toFixed(3)}</td>
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
