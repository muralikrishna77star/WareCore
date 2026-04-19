import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import TransferDetailClient from './TransferDetailClient'

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: transfer } = await supabase
    .from('transfers')
    .select(`
      *,
      from_company:companies!transfers_from_company_id_fkey(name),
      to_company:companies!transfers_to_company_id_fkey(name),
      from_warehouse:warehouses!transfers_from_warehouse_id_fkey(name),
      to_warehouse:warehouses!transfers_to_warehouse_id_fkey(name)
    `)
    .eq('id', id)
    .single()

  if (!transfer) notFound()

  const { data: items } = await supabase
    .from('transfer_items')
    .select(`
      *,
      material_type:material_types(name),
      material_size:material_sizes(size_label)
    `)
    .eq('transfer_id', id)
    .order('id')

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/transfers" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Transfers
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Transfer #{(transfer as any).reference_number ?? id.slice(0, 8)}</h1>
        </div>
      </div>

      {/* Transfer Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Transfer Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Transfer Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate((transfer as any).transfer_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(transfer as any).from_company?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(transfer as any).to_company?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(transfer as any).from_warehouse?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{(transfer as any).to_warehouse?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate((transfer as any).created_at)}</p>
          </div>
        </div>
        {(transfer as any).notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{(transfer as any).notes}</p>
          </div>
        )}
      </div>

      {/* Status + Items (client) */}
      <TransferDetailClient transfer={transfer} items={items ?? []} />

      <div className="flex gap-3 mt-6">
        <Link href="/transfers/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          New Transfer
        </Link>
        <Link href="/transfers" className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          All Transfers
        </Link>
      </div>
    </div>
  )
}
