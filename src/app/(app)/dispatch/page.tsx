import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'

export default async function DispatchPage() {
  const supabase = await createClient()

  const { data: orders } = await supabase
    .from('dispatch_orders')
    .select(`
      id, dispatch_date, vehicle_number, driver_name, notes, created_at,
      company:companies(name, code),
      customer:customers(name),
      dispatch_items(quantity, rate, amount, material_types(name), material_sizes(size_label), size_label)
    `)
    .order('dispatch_date', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispatch Orders</h1>
          <p className="mt-1 text-sm text-gray-500">Sales dispatches to customers</p>
        </div>
        <Link
          href="/dispatch/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Dispatch
        </Link>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🚚</p>
              <p className="text-gray-500">No dispatch orders yet.</p>
              <Link href="/dispatch/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Create first dispatch →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Vehicle</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Qty</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase text-right">Amount</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => {
                  const company = o.company as { name: string; code: string } | null
                  const customer = o.customer as { name: string } | null
                  const items = (o.dispatch_items ?? []) as Array<{ quantity: number; amount: number }>
                  const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0)
                  const totalAmt = items.reduce((s, i) => s + Number(i.amount || 0), 0)

                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {company?.code}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-medium text-gray-900">{customer?.name || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{o.vehicle_number || '—'}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-700">{totalQty.toFixed(3)}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-700">
                        {totalAmt > 0 ? `₹${totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/dispatch/${o.id}`} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
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
