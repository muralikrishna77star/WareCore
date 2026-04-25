import { formatDate, getEntryTypeLabel } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { STOCK_LEDGER_FILTERED_QUERY, ACTIVE_COMPANIES_QUERY } from '@/lib/hasura/queries'

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; material?: string; from?: string; to?: string }>
}) {
  const params = await searchParams

  const conditions: Record<string, unknown>[] = []
  if (params.company) conditions.push({ company_id: { _eq: params.company } })
  if (params.from) conditions.push({ entry_date: { _gte: params.from } })
  if (params.to) conditions.push({ entry_date: { _lte: params.to } })
  const where = conditions.length > 0 ? { _and: conditions } : {}

  const [movResult, compResult] = await Promise.all([
    hasuraQuery(STOCK_LEDGER_FILTERED_QUERY, { where }),
    hasuraQuery(ACTIVE_COMPANIES_QUERY),
  ])
  const movements = movResult.stock_ledger ?? []
  const companies = compResult.companies ?? []

  const entryColors: Record<string, string> = {
    PURCHASE_IN: 'bg-green-100 text-green-800',
    VENDOR_RETURN_IN: 'bg-teal-100 text-teal-800',
    JOB_WORK_RETURN_IN: 'bg-blue-100 text-blue-800',
    TRANSFER_IN: 'bg-indigo-100 text-indigo-800',
    ADJUSTMENT_IN: 'bg-cyan-100 text-cyan-800',
    SALE_OUT: 'bg-red-100 text-red-800',
    JOB_WORK_OUT: 'bg-orange-100 text-orange-800',
    TRANSFER_OUT: 'bg-yellow-100 text-yellow-800',
    ADJUSTMENT_OUT: 'bg-pink-100 text-pink-800',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock Movements</h1>
        <p className="mt-1 text-sm text-gray-500">Full ledger of all inventory movements</p>
      </div>

      {/* Filters */}
      <form className="bg-white rounded-xl border p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
            <select
              name="company"
              defaultValue={params.company || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Companies</option>
              {companies?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              name="from"
              defaultValue={params.from || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              name="to"
              defaultValue={params.to || ''}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Filter
          </button>
          <a href="/movements" className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Clear
          </a>
        </div>
      </form>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {movements.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">No movements found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Warehouse</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Material</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase text-right">Quantity</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map((m: any) => {
                  const isIn = ['PURCHASE_IN', 'VENDOR_RETURN_IN', 'JOB_WORK_RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT_IN'].includes(m.entry_type)
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                        {formatDate(m.entry_date)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${entryColors[m.entry_type] || 'bg-gray-100 text-gray-700'}`}>
                          {getEntryTypeLabel(m.entry_type)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{m.companies?.code}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.warehouses?.name}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{m.material_types?.name}</td>
                      <td className="px-4 py-2.5 text-gray-600">{m.size_label || m.material_sizes?.size_label || '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${isIn ? 'text-green-700' : 'text-red-700'}`}>
                        {isIn ? '+' : '-'}{Math.abs(m.quantity).toFixed(3)} {m.material_types?.unit}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{m.reference_number || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{m.notes || '—'}</td>
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
