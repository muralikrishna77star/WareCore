'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Flips reconciliation_settings.repair_execution_enabled — the single
// audited gate Stage D's execution route checks before doing anything (see
// src/app/api/data-integrity/repair-batches/[id]/route.ts). Read-only badge
// for anyone without CAN_MANAGE_RULES.
export default function RepairExecutionToggle({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/data-integrity/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repairExecutionEnabled: !enabled }),
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

  if (!canManage) {
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
        Repair execution: {enabled ? 'enabled' : 'disabled'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
        Repair execution: {enabled ? 'enabled' : 'disabled'}
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={toggle}
        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        {saving ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
