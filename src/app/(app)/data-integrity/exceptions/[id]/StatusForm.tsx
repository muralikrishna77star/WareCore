'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const OPTIONS = ['ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'IGNORED']

export default function StatusForm({ exceptionId, currentStatus, canClose }: { exceptionId: string; currentStatus: string; canClose: boolean }) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const update = async (status: string) => {
    setSaving(status)
    setError('')
    try {
      const res = await fetch(`/api/data-integrity/exceptions/${exceptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(notes.trim() ? { resolutionNotes: notes.trim() } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional) — saved with the next status change"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const disabled = opt === currentStatus || saving !== null || ((opt === 'RESOLVED' || opt === 'IGNORED') && !canClose)
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => update(opt)}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              title={(opt === 'RESOLVED' || opt === 'IGNORED') && !canClose ? 'Only admin/developer can resolve or ignore' : undefined}
            >
              {saving === opt ? 'Saving…' : `Mark ${opt}`}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
