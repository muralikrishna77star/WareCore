export const dynamic = 'force-dynamic'

import { hasuraQuery } from '@/lib/hasura/server'
import { MOVEMENTS_REPORT_QUERY, ACTIVE_COMPANIES_QUERY, ACTIVE_WAREHOUSES_QUERY } from '@/lib/hasura/queries'
import { PrintButton } from '@/components/PrintButton'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  purchase: { label: 'Purchase', color: 'bg-green-100 text-green-800' },
  transfer_in: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  transfer_out: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  dispatch: { label: 'Dispatch', color: 'bg-red-100 text-red-800' },
  job_work_out: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  job_work_return: { label: 'Job Work Return', color: 'bg-teal-100 text-teal-800' },
  adjustment: { label: 'Adjustment', color: 'bg-gray-100 text-gray-800' },
}

export default async function MovementsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; warehouse?: string; entry_type?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromDate = params.from || firstOfMonth.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { entry_date: { _gte: fromDate } },
    { entry_date: { _lte: toDate } },
  ]
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.warehouse) conditions.push({ warehouse_id: { _eq: params.warehouse } })
  if (params.entry_type) conditions.push({ entry_type: { _eq: params.entry_type } })

  const [result, compResult, whResult] = await Promise.all([
    hasuraQuery(MOVEMENTS_REPORT_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
    hasuraQuery(ACTIVE_WAREHOUSES_QUERY),
  ])

  const movements: any[] = result.stock_ledger ?? []
  const companies: any[] = compResult.companies ?? []
  const allWarehouses: any[] = whResult.warehouses ?? []
  const warehouses = params.company
    ? allWarehouses.filter((w: any) => w.company_id === params.company)
    : allWarehouses

  const totalIn = movements
    .filter(m => ['purchase', 'transfer_in', 'job_work_return'].includes(m.entry_type))
    .reduce((s, m) => s + Number(m.quantity || 0), 0)
  const totalOut = movements
    .filter(m => ['transfer_out', 'dispatch', 'job_work_out'].includes(m.entry_type))
    .reduce((s, m) => s + Number(m.quantity || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movements Report</h1>
          <p className="text-sm text-gray-500 mt-1">Stock ledger movements by type</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Reports</Link>
        </div>
      </div>

      <div className="hidden print:block text-center mb-4">
        <h1 className="text-xl font-bold">Movements Report</h1>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Entry Type</label>
            <select name="entry_type" defaultValue={params.entry_type || ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All Types</option>
              {Object.entries(entryTypeConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
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
        <div className="rounded-xl border bg-gray-50 p-4">
          <p className="text-xs text-gray-500">Total Entries</p>
          <p className="text-xl font-bold text-gray-800">{movements.length}</p>
        </div>
        <div className="rounded-xl border bg-green-50 p-4">
          <p className="text-xs text-gray-500">Total In</p>
          <p className="text-xl font-bold text-green-700">+{totalIn.toFixed(3)} T</p>
        </div>
        <div className="rounded-xl border bg-red-50 p-4">
          <p className="text-xs text-gray-500">Total Out</p>
          <p className="text-xl font-bold text-red-700">-{totalOut.toFixed(3)} T</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50 flex justify-between items-center">
          <span className="font-semibold text-gray-700 text-sm">{fromDate} → {toDate}</span>
          <span className="text-xs text-gray-500">{movements.length} entr{movements.length !== 1 ? 'ies' : 'y'}</span>
        </div>
        <div className="overflow-x-auto">
          {movements.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">No movements found for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Company</th>
                  <th className="px-4 py-3 text-left">Warehouse</th>
                  <th className="px-4 py-3 text-left">Material</th>
                  <th className="px-4 py-3 text-left">Size</th>
                  <th className="px-4 py-3 text-right">Qty (T)</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((m: any) => {
                  const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800' }
                  const isIn = ['purchase', 'transfer_in', 'job_work_return'].includes(m.entry_type)
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{formatDate(m.entry_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">{m.companies?.name}</td>
                      <td className="px-4 py-3 text-gray-500">{m.warehouses?.name}</td>
                      <td className="px-4 py-3 font-medium">{m.material_types?.description}</td>
                      <td className="px-4 py-3 text-gray-500">{m.material_sizes?.size_label ?? m.size_label ?? '—'}</td>
                      <td className={`px-4 py-3 text-right font-medium ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                        {isIn ? '+' : '-'}{Math.abs(Number(m.quantity)).toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{m.reference_id ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="px-4 py-3 text-gray-700" colSpan={6}>Net Movement</td>
                  <td className={`px-4 py-3 text-right ${totalIn - totalOut >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {totalIn - totalOut >= 0 ? '+' : ''}{(totalIn - totalOut).toFixed(3)}
                  </td>
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
