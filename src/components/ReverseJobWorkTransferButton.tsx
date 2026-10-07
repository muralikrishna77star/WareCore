'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { TransferReversalPreview, TransferReversalResult } from '@/lib/jobWorkTransferReversal'

/**
 * Reverse a job work vendor transfer line by line (migration 157). Each
 * line shows whether it can be reversed and, if not, why — material that
 * has moved on from the new vendor (transferred again, sold directly,
 * returned, processed) stays where it is.
 */
export default function ReverseJobWorkTransferButton({
  transferId,
  variant = 'link',
}: {
  transferId: string
  variant?: 'link' | 'button'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<TransferReversalPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<TransferReversalResult | null>(null)

  const handleOpen = async () => {
    setOpen(true)
    setPreviewLoading(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(`/api/jobwork-transfers/${transferId}/reversal-preview`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not load the transfer')
      } else {
        setPreview(data)
        setSelected(new Set())
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setPreviewLoading(false)
    }
  }

  const close = () => {
    setOpen(false)
    setPreview(null)
    setSelected(new Set())
    setNotes('')
    setError(null)
    if (done) router.refresh()
    setDone(null)
  }

  const reversible = (preview?.items ?? []).filter((i) => !i.reversed_at && !i.blocked_reason)
  const allReversibleSelected = reversible.length > 0 && reversible.every((i) => selected.has(i.id))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleReverse = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobwork-transfers/${transferId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: [...selected], notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Reversal failed')
        return
      }
      setDone(data)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  const trigger =
    variant === 'button' ? (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-purple-700 text-sm font-medium rounded-lg border border-purple-300 hover:bg-purple-50"
      >
        <Undo2 className="h-4 w-4" /> Reverse Transfer
      </button>
    ) : (
      <button type="button" onClick={handleOpen} className="text-xs font-medium text-purple-700 hover:underline">
        Reverse
      </button>
    )

  if (!open) return trigger

  const selectedQty = (preview?.items ?? []).filter((i) => selected.has(i.id))

  return (
    <>
      {trigger}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[85vh] overflow-y-auto text-left">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700">
              <Undo2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Reverse Transfer {preview?.transfer_number ?? ''}
              </h2>
              {preview && (
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(preview.transfer_date)}: {preview.from_vendor_name ?? '—'} ({preview.from_reference_number ?? '—'})
                  {' → '}
                  {preview.to_vendor_name ?? '—'} ({preview.to_reference_number ?? '—'}).
                  {' '}Each line you reverse goes back to {preview.from_vendor_name ?? 'the original vendor'}. When every
                  line is reversed, order {preview.to_reference_number ?? ''} is kept as a record and marked Transfer Reversed.
                </p>
              )}
            </div>
          </div>

          {previewLoading && <p className="text-sm text-gray-500 py-4 text-center">Checking each line…</p>}

          {done && (
            <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-3 text-sm text-green-800">
              {done.reversed} {done.reversed === 1 ? 'line' : 'lines'} reversed and returned to {preview?.from_vendor_name ?? 'the original vendor'}.
              {done.destination_deactivated && (
                <> Every line is now reversed, so order {preview?.to_reference_number} has been marked Transfer Reversed.</>
              )}
            </div>
          )}

          {!previewLoading && preview && !done && (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500 uppercase">
                      <th className="px-2 py-2 w-8">
                        <input
                          type="checkbox"
                          aria-label="Select every line that can be reversed"
                          checked={allReversibleSelected}
                          disabled={reversible.length === 0}
                          onChange={() => setSelected(allReversibleSelected ? new Set() : new Set(reversible.map((i) => i.id)))}
                        />
                      </th>
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2">Purchase Line</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.items.map((i) => {
                      const canReverse = !i.reversed_at && !i.blocked_reason
                      return (
                        <tr key={i.id} className={canReverse ? 'hover:bg-gray-50' : 'bg-gray-50/60'}>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Reverse ${i.item_name ?? 'line'}`}
                              checked={selected.has(i.id)}
                              disabled={!canReverse}
                              onChange={() => toggle(i.id)}
                            />
                          </td>
                          <td className="px-2 py-2 align-top text-gray-800">
                            {i.item_name ?? '—'}
                            {i.size_label && <span className="ml-1 text-gray-400">{i.size_label}</span>}
                            {i.job_line_id && <div className="font-mono text-[10px] text-gray-400">{i.job_line_id}</div>}
                          </td>
                          <td className="px-2 py-2 align-top font-mono text-blue-700 whitespace-nowrap">{i.purchase_line_id ?? '—'}</td>
                          <td className="px-2 py-2 align-top text-right font-mono whitespace-nowrap">
                            {Number(i.quantity).toFixed(3)} {i.unit ?? ''}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {i.reversed_at ? (
                              <span className="text-gray-500">
                                Reversed {formatDateTime(i.reversed_at)}
                                {i.reversal_notes ? ` — ${i.reversal_notes}` : ''}
                              </span>
                            ) : i.blocked_reason ? (
                              <span className="text-red-700">{i.blocked_reason}</span>
                            ) : (
                              <span className="text-green-700">Can be reversed</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {reversible.length > 0 && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. Sent to the wrong vendor"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none resize-none"
                  />
                </div>
              )}
              {reversible.length === 0 && (
                <p className="mb-4 text-sm text-gray-600">No line of this transfer can be reversed right now.</p>
              )}
            </>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              onClick={close}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>
            {!done && reversible.length > 0 && (
              <button
                onClick={handleReverse}
                disabled={loading || previewLoading || selected.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-60 flex items-center gap-2"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                {loading
                  ? 'Reversing…'
                  : selected.size === 0
                    ? 'Select lines to reverse'
                    : `Reverse ${selected.size} ${selected.size === 1 ? 'line' : 'lines'} (${selectedQty
                        .reduce((s, i) => s + Number(i.quantity), 0)
                        .toFixed(3)})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
