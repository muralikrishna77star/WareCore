import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default async function TransfersPage() {
  const supabase = await createClient()

  const { data: transfers } = await supabase
    .from('transfers')
    .select(`
      id, transfer_date, status, notes, created_at,
      from_company:companies!transfers_from_company_id_fkey(name, code),
      to_company:companies!transfers_to_company_id_fkey(name, code),
      from_warehouse:warehouses!transfers_from_warehouse_id_fkey(name),
      to_warehouse:warehouses!transfers_to_warehouse_id_fkey(name),
      transfer_items(quantity, material_types(name), material_sizes(size_label), size_label)
    `)
    .order('transfer_date', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transfers</h1>
          <p className="mt-1 text-sm text-gray-500">Inter-company and inter-warehouse material transfers</p>
        </div>
        <Link
          href="/transfers/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Transfer
        </Link>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {!transfers || transfers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">↔️</p>
              <p className="text-gray-500">No transfers yet.</p>
              <Link href="/transfers/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Create first transfer →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Items</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map((t) => {
                  const fromCo = t.from_company as { name: string; code: string } | null
                  const toCo = t.to_company as { name: string; code: string } | null
                  const fromWh = t.from_warehouse as { name: string } | null
                  const toWh = t.to_warehouse as { name: string } | null
                  const items = (t.transfer_items ?? []) as Array<{ quantity: number; material_types: { name: string } | null; material_sizes: { label: string } | null; size_label: string | null }>
                  const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0)

                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(t.transfer_date)}</td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{fromCo?.code || '—'}</p>
                        <p className="text-xs text-gray-500">{fromWh?.name || '—'}</p>
                      </td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{toCo?.code || '—'}</p>
                        <p className="text-xs text-gray-500">{toWh?.name || '—'}</p>
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-gray-700">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-gray-500">{totalQty.toFixed(3)} tons</p>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[t.status] || 'bg-gray-100 text-gray-700'}`}>
                          {t.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/transfers/${t.id}`} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
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
