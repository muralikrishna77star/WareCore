'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PurgeBillButton({ billId }: { billId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePurge = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/bills/${billId}/purge`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Purge failed'); setLoading(false); return }
      router.push('/purchase-cancellations')
      router.refresh()
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-200 transition-colors">
        Purge Record
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-lg">
            🗑
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Purge Cancelled Bill</h2>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently move the bill to the <strong>Purchase Cancellations</strong> archive and remove it from the active bills list. The action cannot be undone.
            </p>
          </div>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={() => { setOpen(false); setError(null) }} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Keep
          </button>
          <button onClick={handlePurge} disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
            {loading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
            {loading ? 'Purging…' : 'Yes, Purge'}
          </button>
        </div>
      </div>
    </div>
  )
}
