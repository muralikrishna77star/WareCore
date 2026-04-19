import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatCurrency } from '@/lib/utils'

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('dispatch_orders')
    .select(`
      *,
      company:companies(name),
      warehouse:warehouses(name),
      customer:customers(name)
    `)
    .eq('id', id)
    .single()

  if (!order) notFound()

  const { data: items } = await supabase
    .from('dispatch_items')
    .select(`
      *,
      material_type:material_types(name),
      material_size:material_sizes(size_label)
    `)
    .eq('dispatch_order_id', id)
    .order('id')

  const totalAmount = items?.reduce((sum, i) => sum + (i.amount || 0), 0) ?? 0
  const totalQty = items?.reduce((sum, i) => sum + (i.quantity || 0), 0) ?? 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/dispatch" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Dispatch
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Dispatch: {(order as any).invoice_number ?? id.slice(0, 8)}
          </h1>
        </div>
        <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
          Dispatch Order
        </span>
      </div>

      {/* Order Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Dispatch Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate((order as any).dispatch_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).customer?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).company?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).warehouse?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Vehicle</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).vehicle_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Driver</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).driver_name ?? '—'}</p>
          </div>
        </div>
        {(order as any).notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{(order as any).notes}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Dispatched Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity (MT)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Rate (₹/MT)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items?.map((item, idx) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{(item.material_type as any)?.name ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{(item.material_size as any)?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">{item.quantity?.toFixed(3)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">
                    {item.rate ? formatCurrency(item.rate) : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 text-right">
                    {item.amount ? formatCurrency(item.amount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={3} className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">Totals</td>
                <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">{totalQty.toFixed(3)} MT</td>
                <td></td>
                <td className="px-6 py-4 text-sm font-bold text-blue-700 text-right">{formatCurrency(totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex gap-3">
        <Link href="/dispatch/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          New Dispatch
        </Link>
        <Link href="/dispatch" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Dispatches
        </Link>
      </div>
    </div>
  )
}
