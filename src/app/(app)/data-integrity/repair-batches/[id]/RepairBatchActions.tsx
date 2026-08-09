'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Renders only the button(s) valid for the batch's CURRENT status, mirroring
// the server-side ALLOWED_TRANSITIONS map in
// src/app/api/data-integrity/repair-batches/[id]/route.ts — this component
// never assumes a transition is legal, the API is the source of truth and
// re-checks everything again.
export default function RepairBatchActions({
  batchId,
  currentStatus,
  canPropose,
  canApprove,
  isOwnRequest,
}: {
  batchId: string
  currentStatus: string
  canPropose: boolean
  canApprove: boolean
  isOwnRequest: boolean
}) {
  const router = useRouter()
  const [rejectionReason, setRejectionReason] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const patch = async (status: string, extra?: Record<string, unknown>) => {
    setSaving(status)
    setError('')
    try {
      const res = await fetch(`/api/data-integrity/repair-batches/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
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

  const executeWithConfirm = () => {
    if (!window.confirm('Have you taken a fresh database backup? This repair archives a stock_ledger row and cannot be undone from the UI.')) return
    patch('EXECUTED')
  }

  return (
    <div className="space-y-3">
      {currentStatus === 'DRAFT' && (
        <button
          type="button"
          disabled={!canPropose || saving !== null}
          onClick={() => patch('PENDING_APPROVAL')}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {saving === 'PENDING_APPROVAL' ? 'Submitting…' : 'Submit for approval'}
        </button>
      )}

      {currentStatus === 'PENDING_APPROVAL' && (
        <div className="space-y-2">
          {isOwnRequest && (
            <p className="text-xs text-amber-700">Maker-checker: you requested this batch, so you cannot approve or reject it — a different admin/developer must.</p>
          )}
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Rejection reason (optional)"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canApprove || isOwnRequest || saving !== null}
              onClick={() => patch('APPROVED')}
              className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-40"
            >
              {saving === 'APPROVED' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={!canApprove || isOwnRequest || saving !== null}
              onClick={() => patch('REJECTED', { rejectionReason })}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {saving === 'REJECTED' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {currentStatus === 'APPROVED' && (
        <button
          type="button"
          disabled={!canApprove || saving !== null}
          onClick={executeWithConfirm}
          className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-40"
        >
          {saving === 'EXECUTED' ? 'Executing…' : 'Execute'}
        </button>
      )}

      {currentStatus === 'EXECUTION_FAILED' && (
        <button
          type="button"
          disabled={!canApprove || saving !== null}
          onClick={() => patch('ROLLED_BACK')}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          {saving === 'ROLLED_BACK' ? 'Marking…' : 'Mark rolled back'}
        </button>
      )}

      {['REJECTED', 'EXECUTED', 'ROLLED_BACK'].includes(currentStatus) && (
        <p className="text-xs text-gray-500">No further actions — this batch is terminal.</p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
