'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'

type Preview = {
  blocked?: boolean
  reason?: string
  dispatches?: { id: string; invoice_number: string | null; sale_ref_id: string | null; dispatch_date: string; customer_name: string | null }[]
  transfers?: { id: string; transfer_number: string; transfer_date: string; to_vendor_name: string | null }[]
}

export default function DeleteJobWorkTransferButton({ transferId }: { transferId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleOpen = async () => {
    setOpen(true)
    setPreviewLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobwork-transfers/${transferId}/preview-delete`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load preview')
      } else {
        setPreview(data)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobwork-transfers/${transferId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Delete failed')
        setLoading(false)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  const close = () => {
    setOpen(false)
    setError(null)
    setPreview(null)
    setNotes('')
  }

  const hasCascade = !!(preview?.transfers?.length || preview?.dispatches?.length)
  const isBlocked = !!preview?.blocked

  if (!open) {
    return (
      <button type="button" onClick={handleOpen} className="text-xs text-red-600 hover:underline">
        Delete
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg">
            ⚠
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Delete Vendor Transfer</h2>
            <p className="text-sm text-gray-500 mt-1">
              Deletes the destination job work order and restores the transferred quantity to the
              original vendor. This cannot be undone.
            </p>
          </div>
        </div>

        {previewLoading && <p className="text-sm text-gray-500 py-4 text-center">Checking what this would affect…</p>}

        {!previewLoading && isBlocked && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
            <p className="font-medium mb-1">Cannot delete this transfer</p>
            <p>{preview?.reason}</p>
          </div>
        )}

        {!previewLoading && !isBlocked && hasCascade && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
            <p className="font-medium mb-2">This will also reverse the following, since the material moved on from here:</p>
            {!!preview?.dispatches?.length && (
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase text-amber-700 mb-1">Sales to cancel</p>
                <ul className="space-y-1">
                  {preview.dispatches.map((d) => (
                    <li key={d.id} className="text-xs">
                      {d.invoice_number || d.sale_ref_id || d.id} — {formatDate(d.dispatch_date)}
                      {d.customer_name ? ` — ${d.customer_name}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!preview?.transfers?.length && (
              <div>
                <p className="text-xs font-semibold uppercase text-amber-700 mb-1">Further transfers to reverse</p>
                <ul className="space-y-1">
                  {preview.transfers.map((t) => (
                    <li key={t.id} className="text-xs">
                      {t.transfer_number} — {formatDate(t.transfer_date)}
                      {t.to_vendor_name ? ` — to ${t.to_vendor_name}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!previewLoading && !isBlocked && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Created in error, wrong vendor selected…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none resize-none"
            />
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={close}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {isBlocked ? 'Close' : 'Keep Transfer'}
          </button>
          {!isBlocked && (
            <button
              onClick={handleDelete}
              disabled={loading || previewLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-2"
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
              {loading ? 'Deleting…' : hasCascade ? 'Yes, Reverse Everything Above' : 'Yes, Delete Transfer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
