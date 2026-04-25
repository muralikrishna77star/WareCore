import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { TRANSFER_BY_ID_QUERY, TRANSFER_ITEMS_QUERY } from '@/lib/hasura/queries'
import TransferDetailClient from './TransferDetailClient'

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [transferResult, itemsResult] = await Promise.all([
    hasuraQuery(TRANSFER_BY_ID_QUERY, { id }),
    hasuraQuery(TRANSFER_ITEMS_QUERY, { transfer_id: id }),
  ])
  const transfer = transferResult.transfers_by_pk
  if (!transfer) notFound()
  const items = itemsResult.transfer_items ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/transfers" className="text-sm text-blue-600 hover:underline mb-1 block">
            ← Back to Transfers
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Transfer #{transfer.reference_number ?? id.slice(0, 8)}</h1>
        </div>
      </div>

      {/* Transfer Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Transfer Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Transfer Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(transfer.transfer_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{transfer.companies_from?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Company</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{transfer.companies_to?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">From Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{transfer.warehouses_from?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">To Warehouse</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{transfer.warehouses_to?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Created</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{formatDate(transfer.created_at)}</p>
          </div>
        </div>
        {transfer.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{transfer.notes}</p>
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
