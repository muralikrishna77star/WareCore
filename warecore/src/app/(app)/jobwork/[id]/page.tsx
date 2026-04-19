import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import JobWorkReturnClient from './JobWorkReturnClient'

export default async function JobWorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('job_work_orders')
    .select(`
      *,
      company:companies(name),
      warehouse:warehouses(name),
      vendor:suppliers(name)
    `)
    .eq('id', id)
    .single()

  if (!order) notFound()

  const { data: items } = await supabase
    .from('job_work_items')
    .select(`
      *,
      material_type:material_types(name),
      material_size:material_sizes(size_label)
    `)
    .eq('job_work_order_id', id)
    .order('id')

  const isOverdue =
    order.expected_return_date &&
    !order.actual_return_date &&
    new Date(order.expected_return_date) < new Date()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/jobwork" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Job Work
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Job Work Order: {(order as any).reference_number ?? id.slice(0, 8)}
          </h1>
        </div>
        {isOverdue && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
            Overdue
          </span>
        )}
      </div>

      {/* Order Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Dispatch Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate((order as any).dispatch_date)}</p>
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
            <p className="text-xs text-gray-500 uppercase tracking-wide">Vendor</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(order as any).vendor?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Expected Return</p>
            <p className={`text-sm font-medium mt-1 ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
              {(order as any).expected_return_date ? formatDate((order as any).expected_return_date) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Actual Return</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {(order as any).actual_return_date ? formatDate((order as any).actual_return_date) : 'Pending'}
            </p>
          </div>
        </div>
        {(order as any).notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{(order as any).notes}</p>
          </div>
        )}
      </div>

      {/* Status + Return Form (client) */}
      <JobWorkReturnClient order={order} items={items ?? []} />

      <div className="flex gap-3 mt-6">
        <Link href="/jobwork/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          New Order
        </Link>
        <Link href="/jobwork" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Orders
        </Link>
      </div>
    </div>
  )
}
