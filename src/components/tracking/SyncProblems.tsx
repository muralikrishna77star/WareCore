'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { OFFLINE_ACTION_LABELS, type SyncProblem } from '@/lib/tracking/offlineShared'
import { errorText, formatWhen, trackingApi } from './api'

/** Offline scans the server refused, for a manager to look at and mark reviewed. Nothing here changes a bundle. */
export function SyncProblems({ canReview }: { canReview: boolean }) {
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [rows, setRows] = useState<SyncProblem[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const fetchRows = useCallback(() => trackingApi<{ problems: SyncProblem[] }>(`sync-problems?show=${show}`), [show])

  useEffect(() => {
    let current = true
    fetchRows()
      .then((data) => { if (current) { setRows(data.problems); setError('') } })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchRows])

  const review = async (id: string) => {
    setBusy(id)
    setError('')
    try {
      await trackingApi(`sync-problems/${id}`, { method: 'POST', body: { note: notes[id] ?? '' } })
      setRows((await fetchRows()).problems)
    } catch (err) {
      setError(errorText(err))
    }
    setBusy('')
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Scans saved on a phone without a signal that the server refused when they arrived, with the reason. They were never applied.
        Check each bundle, redo the step online if it is still needed, then mark it reviewed.
      </p>
      <div className="flex gap-2 text-sm">
        {(['open', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setShow(value)}
            className={`rounded-lg border px-3 py-1.5 font-medium ${show === value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {value === 'open' ? 'Not reviewed' : 'All'}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500">{show === 'open' ? 'No refused scans are waiting for review.' : 'No offline scan has been refused.'}</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Scanned</th><th className="px-4 py-2">Step</th><th className="px-4 py-2">Bundle</th>
                <th className="px-4 py-2">Why it was refused</th><th className="px-4 py-2">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                    {formatWhen(p.scanned_at)}
                    <span className="block text-xs text-gray-500">by {p.actor_name}, sent {formatWhen(p.received_at)}</span>
                    <span className="block text-xs text-gray-500">{p.warehouse_name}</span>
                  </td>
                  <td className="px-4 py-2">{OFFLINE_ACTION_LABELS[p.action] ?? p.action}</td>
                  <td className="px-4 py-2">
                    {p.tracking_unit_id
                      ? <Link href={`/tracking/units/${p.tracking_unit_id}`} className="font-mono text-blue-600 hover:underline">{p.stock_tracking_id}</Link>
                      : <span className="font-mono text-gray-700">{p.code ?? ''}</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-800">{p.refusal_reason}</td>
                  <td className="px-4 py-2">
                    {p.reviewed_at ? (
                      <span className="text-xs text-gray-600">Reviewed by {p.reviewed_by_name}, {formatWhen(p.reviewed_at)}{p.review_note && `: ${p.review_note}`}</span>
                    ) : canReview ? (
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={notes[p.id] ?? ''}
                          onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })}
                          placeholder="What was done (optional)"
                          className="w-48 rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <button type="button" disabled={busy === p.id} onClick={() => review(p.id)} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                          Mark reviewed
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Waiting for a manager</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
