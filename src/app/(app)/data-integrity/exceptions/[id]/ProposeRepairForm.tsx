'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Only one repair type is wired up in this release — see
// docs/data-integrity/REPAIR_GOVERNANCE.md. The API derives the actual
// proposal (which ledger row to keep/archive) from the exception's own
// evidence; this form doesn't send one.
export default function ProposeRepairForm({ exceptionId }: { exceptionId: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const propose = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/data-integrity/repair-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionId, proposedAction: 'ARCHIVE_DUPLICATE_LEDGER_ROW' }),
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
      setSaving(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={saving}
        onClick={propose}
        className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
      >
        {saving ? 'Proposing…' : 'Propose: Archive duplicate ledger row'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
