'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SubmitBillButton({ billId, hasWarehouse }: { billId: string; hasWarehouse: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!hasWarehouse) { setError('Set a warehouse on this bill before submitting. Use Edit to update it.'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/bills/${billId}/submit`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Submit failed'); setLoading(false); return }
      router.refresh()
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Submitting…' : '✓ Submit Bill'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
