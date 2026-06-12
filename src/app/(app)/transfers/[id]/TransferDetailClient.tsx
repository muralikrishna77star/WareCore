'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { UPDATE_TRANSFER_STATUS_MUTATION } from '@/lib/hasura/queries'

interface TransferDetailClientProps {
  transfer: any
  items: any[]
}

export default function TransferDetailClient({ transfer, items }: TransferDetailClientProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function updateStatus(newStatus: string) {
    setLoading(true)
    setError('')
    const { error: err } = await hasuraFetch(UPDATE_TRANSFER_STATUS_MUTATION, {
      id: transfer.id,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    if (err) {
      setError(err.message)
      setLoading(false)
    } else {
      router.refresh()
      setLoading(false)
    }
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_transit: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[transfer.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {transfer.status.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
        </span>

        {transfer.status === 'pending' && (
          <button
            onClick={() => updateStatus('in_transit')}
            disabled={loading}
            className="px-3 py-1 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Mark In Transit
          </button>
        )}
        {transfer.status === 'in_transit' && (
          <button
            onClick={() => updateStatus('completed')}
            disabled={loading}
            className="px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            Mark Completed
          </button>
        )}
        {(transfer.status === 'pending' || transfer.status === 'in_transit') && (
          <button
            onClick={() => updateStatus('cancelled')}
            disabled={loading}
            className="px-3 py-1 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{error}</p>
      )}

      {/* Items table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Transfer Items</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity (MT)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item: any, idx: number) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.material_type?.name ?? '—'}</td>
                <td className="px-6 py-4 text-sm text-gray-700">{item.material_size?.size_label ?? item.size_label ?? '—'}</td>
                <td className="px-6 py-4 text-sm text-gray-900 text-right">{item.quantity?.toFixed(3)}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{item.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 border-gray-200">
            <tr>
              <td colSpan={3} className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">Total</td>
              <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">
                {items.reduce((s, i) => s + (i.quantity || 0), 0).toFixed(3)} MT
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
