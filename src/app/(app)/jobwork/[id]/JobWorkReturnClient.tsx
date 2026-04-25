'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  UPDATE_JOB_WORK_ITEM_MUTATION,
  UPDATE_JOB_WORK_ORDER_STATUS_MUTATION,
} from '@/lib/hasura/queries'

interface JobWorkReturnClientProps {
  order: any
  items: any[]
}

export default function JobWorkReturnClient({ order, items }: JobWorkReturnClientProps) {
  const router = useRouter()
  const [quantities, setQuantities] = useState<Record<number, string>>(
    Object.fromEntries(items.map((i) => [i.id, String(i.quantity_received ?? 0)]))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleReturn() {
    setLoading(true)
    setError('')
    setSuccess('')

    for (const item of items) {
      const qty = parseFloat(quantities[item.id] ?? '0')
      const { error: err } = await hasuraFetch(UPDATE_JOB_WORK_ITEM_MUTATION, {
        id: item.id,
        quantity_received: qty,
      })
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
    }

    // Check if all items fully returned
    const allReturned = items.every((item) => {
      const qty = parseFloat(quantities[item.id] ?? '0')
      return qty >= (item.quantity_sent || 0)
    })

    if (allReturned) {
      await hasuraFetch(UPDATE_JOB_WORK_ORDER_STATUS_MUTATION, {
        id: order.id,
        status: 'completed',
        actual_return_date: new Date().toISOString().split('T')[0],
      })
    } else {
      await hasuraFetch(UPDATE_JOB_WORK_ORDER_STATUS_MUTATION, {
        id: order.id,
        status: 'partial_return',
        actual_return_date: null,
      })
    }

    setSuccess('Return quantities saved.')
    setLoading(false)
    router.refresh()
  }

  const statusColors: Record<string, string> = {
    dispatched: 'bg-blue-100 text-blue-800',
    partial_return: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[order.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {order.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
        </span>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{error}</p>}
      {success && <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4">{success}</p>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Job Work Items — Record Returns</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Dispatched (MT)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Returned (MT)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item: any, idx: number) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.material_types?.name ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">{item.quantity_sent?.toFixed(3)}</td>
                  <td className="px-6 py-4 text-right">
                    {order.status === 'completed' ? (
                      <span className="text-sm text-gray-900">{item.quantity_received?.toFixed(3)}</span>
                    ) : (
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        max={item.quantity_sent}
                        value={quantities[item.id] ?? '0'}
                        onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className="w-28 px-2 py-1 text-sm border border-gray-300 rounded text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{item.work_type ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.status !== 'completed' && order.status !== 'cancelled' && (
        <button
          onClick={handleReturn}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save Return Quantities'}
        </button>
      )}
    </div>
  )
}
