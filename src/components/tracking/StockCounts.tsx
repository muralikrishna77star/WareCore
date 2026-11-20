'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  COUNT_DECISION_LABELS, COUNT_DECISIONS_FOR, COUNT_OUTCOME_LABELS, COUNT_STATUS_LABELS,
  type CountDecision, type CountStatus, type StockCountLine, type StockCountSummary,
} from '@/lib/tracking/offlineShared'
import { LIFECYCLE_LABELS, type LifecycleStatus } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'

const COUNT_STYLES: Record<CountStatus, string> = {
  OPEN: 'bg-gray-100 text-gray-800',
  SUBMITTED: 'bg-amber-100 text-amber-800',
  CLOSED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
}

export function CountBadge({ status }: { status: CountStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COUNT_STYLES[status]}`}>{COUNT_STATUS_LABELS[status]}</span>
}

const statusWords = (status: string | null) =>
  status == null ? '' : status === 'VOIDED' ? 'Voided' : LIFECYCLE_LABELS[status as LifecycleStatus] ?? status

export function StockCountList() {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<StockCountSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    trackingApi<{ counts: StockCountSummary[] }>(`counts${status ? `?status=${status}` : ''}`)
      .then((data) => { if (current) { setRows(data.counts); setError('') } })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [status])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Status">
          <option value="">All counts</option>
          {Object.entries(COUNT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Link href="/offline-scan" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Count a location on the Offline Scan screen
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500">No stock counts yet. Counts are started by scanning a location on the Offline Scan screen.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Count</th><th className="px-4 py-2">Location</th><th className="px-4 py-2">Warehouse</th>
                <th className="px-4 py-2">Status</th><th className="px-4 py-2">Started</th>
                <th className="px-4 py-2 text-right">Scanned</th><th className="px-4 py-2 text-right">Differences</th><th className="px-4 py-2 text-right">To decide</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2"><Link href={`/tracking/counts/${c.id}`} className="font-mono text-blue-600 hover:underline">{c.count_no}</Link></td>
                  <td className="px-4 py-2 font-mono">{c.location_code}</td>
                  <td className="px-4 py-2">{c.warehouse_name}</td>
                  <td className="px-4 py-2"><CountBadge status={c.status} /></td>
                  <td className="px-4 py-2 text-gray-600">{formatWhen(c.started_at)}<span className="block text-xs">{c.started_by_name}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.scanned}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.status === 'OPEN' ? '' : c.differences}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-amber-700">{c.undecided || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function StockCountDetail({ countId, canManage, canOperate }: { countId: string; canManage: boolean; canOperate: boolean }) {
  const [data, setData] = useState<{ count: StockCountSummary; lines: StockCountLine[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [cancelReason, setCancelReason] = useState('')

  const fetchData = useCallback(() => trackingApi<{ count: StockCountSummary; lines: StockCountLine[] }>(`counts/${countId}`), [countId])

  useEffect(() => {
    let current = true
    fetchData()
      .then((result) => { if (current) setData(result) })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchData])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      setData(await trackingApi(`counts/${countId}`, { method: 'POST', body }))
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>
  const { count, lines } = data
  const differences = lines.filter((l) => l.outcome && l.outcome !== 'FOUND')
  const found = lines.filter((l) => l.outcome === 'FOUND')

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <h2 className="font-mono text-xl font-semibold text-gray-900">{count.count_no}</h2>
          <p className="text-sm text-gray-700">Location <span className="font-mono">{count.location_code}</span> · {count.warehouse_name}</p>
          <p className="mt-1 text-xs text-gray-500">
            Started {formatWhen(count.started_at)} by {count.started_by_name}
            {count.submitted_at && ` · submitted ${formatWhen(count.submitted_at)}`}
            {count.closed_at && ` · ${count.status === 'CANCELLED' ? 'cancelled' : 'closed'} ${formatWhen(count.closed_at)}`}
          </p>
          {count.cancel_reason && <p className="mt-1 text-sm text-gray-700">Reason: {count.cancel_reason}</p>}
        </div>
        <CountBadge status={count.status} />
      </section>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {count.status === 'OPEN' && (
        <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="text-gray-700">{count.scanned} labels scanned so far. Finish the count on the Offline Scan screen that started it.</p>
          {canOperate && (
            <div className="flex flex-wrap gap-2">
              <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancelling" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2" />
              <button type="button" disabled={busy} onClick={() => post({ action: 'cancel', reason: cancelReason })} className="rounded-lg border border-red-300 px-3 py-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                Cancel count
              </button>
            </div>
          )}
        </section>
      )}

      {count.status !== 'OPEN' && (
        <section className="space-y-2">
          <h3 className="font-semibold text-gray-900">Differences ({differences.length})</h3>
          {differences.length === 0 ? (
            <p className="text-sm text-gray-500">Every bundle was where tracking expected it.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr><th className="px-4 py-2">Outcome</th><th className="px-4 py-2">Bundle</th><th className="px-4 py-2">Tracking had it</th><th className="px-4 py-2">Now</th><th className="px-4 py-2">Decision</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {differences.map((line) => {
                    const choices = COUNT_DECISIONS_FOR[line.outcome!]
                    return (
                      <tr key={line.id} className="align-top">
                        <td className="px-4 py-2 font-medium text-amber-800">{COUNT_OUTCOME_LABELS[line.outcome!]}</td>
                        <td className="px-4 py-2">
                          {line.tracking_unit_id
                            ? <Link href={`/tracking/units/${line.tracking_unit_id}`} className="font-mono text-blue-600 hover:underline">{line.stock_tracking_id}</Link>
                            : <span className="font-mono">{line.scanned_code}</span>}
                          {line.item_code && <span className="block text-xs text-gray-600">{line.item_code} {line.size_label} · {line.quantity} {line.unit}</span>}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{[statusWords(line.status_at_submit), line.expected_location_code].filter(Boolean).join(' at ') || 'Not a bundle of this warehouse'}</td>
                        <td className="px-4 py-2 text-gray-700">{[statusWords(line.current_status), line.current_location_code].filter(Boolean).join(' at ')}</td>
                        <td className="px-4 py-2">
                          {line.decision ? (
                            <span className="text-gray-800">
                              {COUNT_DECISION_LABELS[line.decision]}
                              <span className="block text-xs text-gray-500">{line.decided_by_name}, {line.decided_at && formatWhen(line.decided_at)}{line.decision_note && `: ${line.decision_note}`}</span>
                            </span>
                          ) : canManage && count.status === 'SUBMITTED' ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={notes[line.id] ?? ''}
                                onChange={(e) => setNotes({ ...notes, [line.id]: e.target.value })}
                                placeholder="Note (optional)"
                                className="w-40 rounded border border-gray-300 px-2 py-1 text-xs"
                              />
                              {choices.map((choice: CountDecision) => (
                                <button
                                  key={choice}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => post({ action: 'decide', line_id: line.id, decision: choice, note: notes[line.id] ?? '' })}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  {choice === 'MARKED_MISSING' ? 'Mark missing' : choice === 'MOVED_HERE' ? `Move to ${count.location_code}` : 'Ignore'}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-500">Waiting for a manager</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold text-gray-900">{count.status === 'OPEN' ? 'Scanned so far' : `Found where expected (${found.length})`}</h3>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
          {(count.status === 'OPEN' ? lines : found).map((line) => (
            <li key={line.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
              <span className="font-mono">{line.stock_tracking_id ?? line.scanned_code}</span>
              <span className="text-gray-600">{line.item_code} {line.size_label} {line.quantity && `· ${line.quantity} ${line.unit}`}</span>
            </li>
          ))}
          {(count.status === 'OPEN' ? lines : found).length === 0 && <li className="px-4 py-2 text-gray-500">None</li>}
        </ul>
      </section>
    </div>
  )
}
