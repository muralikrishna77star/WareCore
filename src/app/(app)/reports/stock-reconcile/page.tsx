'use client'

import { useState } from 'react'
import Link from 'next/link'

type TotalRow = { category: string; sourceQty: number; ledgerQty: number; diff: number; matches: boolean }
type StaleRecord = {
  id: string
  entryType: string
  referenceType: string
  referenceNumber: string | null
  quantity: number
  entryDate: string
  materialCode: string | null
  sizeLabel: string | null
}
type DuplicateGroup = {
  referenceType: string
  referenceNumber: string | null
  entryType: string
  purchaseLineId: string | null
  sizeLabel: string | null
  rowCount: number
  netQty: number
  latestEntryDate: string
}

const categoryLabels: Record<string, string> = {
  purchases: 'Purchases',
  sales: 'Sales / Dispatch',
  job_work: 'Job Work (Out)',
  purchase_cancellations: 'Purchase Cancellations',
  sale_cancellations: 'Sale Cancellations',
  job_work_cancellations: 'Job Work Cancellations',
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function StockReconcilePage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ reconciled: number } | null>(null)
  const [error, setError] = useState('')

  const runReconcile = async () => {
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/stock/reconcile', { method: 'POST' })
      let data: any
      try { data = await res.json() } catch { data = {} }
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRunning(false)
    }
  }

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 8 }, (_, i) => currentYear - i)

  const [from, setFrom] = useState(`${currentYear}-01-01`)
  const [to, setTo] = useState(todayStr())
  const [year, setYear] = useState(String(currentYear))
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [totals, setTotals] = useState<TotalRow[] | null>(null)
  const [staleRecords, setStaleRecords] = useState<StaleRecord[] | null>(null)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null)

  const applyYear = (y: string) => {
    setYear(y)
    if (y === 'all') {
      setFrom('2000-01-01')
      setTo(todayStr())
    } else {
      setFrom(`${y}-01-01`)
      setTo(`${y}-12-31`)
    }
  }

  const runVerify = async () => {
    setVerifying(true)
    setVerifyError('')
    setTotals(null)
    setStaleRecords(null)
    setDuplicateGroups(null)
    try {
      const res = await fetch(`/api/stock/verify?from=${from}&to=${to}`)
      const data = await res.json()
      if (!res.ok) { setVerifyError(data.error || `Server error (${res.status})`); return }
      setTotals(data.totals)
      setStaleRecords(data.staleRecords)
      setDuplicateGroups(data.duplicateGroups)
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setVerifying(false)
    }
  }

  const fmt = (n: number) => n.toFixed(3)

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">Fix phantom stock entries caused by bill edits</p>
        </div>
        <Link href="/reports/stock-statement" className="text-sm text-blue-600 hover:underline">
          ← Stock Statement
        </Link>
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-1">What this does</h2>
          <p className="text-sm text-gray-600">
            When a purchase bill is edited (lines deleted and re-entered), the original stock-in entries
            were not always reversed. This tool finds all such <strong>phantom stock entries</strong> —
            purchase line IDs that appear in the stock ledger but no longer exist in any bill —
            and inserts corrective PURCHASE_CANCEL entries to zero them out.
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Going forward, the system automatically reverses stock when bill items are deleted
            (migration 029). This reconciliation fixes only past data.
          </p>
        </div>

        <div className="border-t pt-4">
          <button
            type="button"
            onClick={runReconcile}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            {running ? 'Running…' : 'Run Reconciliation'}
          </button>
        </div>

        {result && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            {result.reconciled === 0 ? (
              <p className="text-sm font-medium text-green-800">
                No phantom entries found — stock ledger is already clean.
              </p>
            ) : (
              <p className="text-sm font-medium text-green-800">
                Reconciled {result.reconciled} phantom purchase line{result.reconciled !== 1 ? 's' : ''}.
                The stock statement should now reflect accurate figures.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-1">Stock Verification</h2>
          <p className="text-sm text-gray-600">
            Physically cross-checks Purchases, Sales, Job Work, and their Cancellations against the
            stock ledger for a date range, and surfaces any stale or duplicate ledger entries — a
            read-only check, same totals methodology as the Reports Dashboard.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => applyYear(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Time</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setYear('') }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setYear('') }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={runVerify}
            disabled={verifying}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        </div>

        {verifyError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{verifyError}</p>
          </div>
        )}

        {totals && (
          <div className="border-t pt-4 space-y-2">
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left">
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Source Total</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Ledger Total</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Diff</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {totals.map((row) => (
                    <tr key={row.category}>
                      <td className="px-4 py-2 font-medium text-gray-900">{categoryLabels[row.category] || row.category}</td>
                      <td className="px-4 py-2 text-right">{fmt(row.sourceQty)}</td>
                      <td className="px-4 py-2 text-right">{fmt(row.ledgerQty)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${row.matches ? 'text-gray-500' : 'text-red-600'}`}>
                        {fmt(row.diff)}
                      </td>
                      <td className="px-4 py-2">
                        {row.matches ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Match</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Mismatch</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">
              Cancellation rows can legitimately differ from the ledger total — a mid-edit stock reversal
              creates the same PURCHASE_CANCEL / SALE_CANCEL / JOB_WORK_CANCEL entry type as a full order
              cancellation, so the ledger total may run higher than the cancelled-order archive total.
            </p>
          </div>
        )}

        {staleRecords && (
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-900 mb-2">
              Stale Records {staleRecords.length > 0 && <span className="text-red-600">({staleRecords.length})</span>}
            </h3>
            {staleRecords.length === 0 ? (
              <p className="text-sm text-green-700">None found — every ledger entry traces back to a live or archived order.</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-2">
                  Ledger entries referencing an order that no longer exists, and isn&apos;t in its cancellation archive either.
                </p>
                <div className="overflow-auto max-h-80 rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="border-b text-left">
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Reference</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Material</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {staleRecords.map((r) => (
                        <tr key={r.id}>
                          <td className="px-4 py-2 whitespace-nowrap">{r.entryDate}</td>
                          <td className="px-4 py-2">{r.entryType}</td>
                          <td className="px-4 py-2 font-mono text-xs">{r.referenceNumber || '—'}</td>
                          <td className="px-4 py-2">{r.materialCode}{r.sizeLabel ? ` (${r.sizeLabel})` : ''}</td>
                          <td className="px-4 py-2 text-right">{fmt(r.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {duplicateGroups && (
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-900 mb-2">
              Duplicate Ledger Rows {duplicateGroups.length > 0 && <span className="text-orange-600">({duplicateGroups.length})</span>}
            </h3>
            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-green-700">None found — every order line has exactly one in-type ledger row.</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-2">
                  Lines with more than one Purchase In / Sale Out / Job Work Out row — usually leftover from
                  repeated edits before migrations 041/052.
                </p>
                <div className="overflow-auto max-h-80 rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="border-b text-left">
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Reference</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Line</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Rows</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase text-right">Net Qty</th>
                        <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase">Latest</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {duplicateGroups.map((g, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2 font-mono text-xs">{g.referenceNumber || '—'}</td>
                          <td className="px-4 py-2">{g.entryType}</td>
                          <td className="px-4 py-2">{g.purchaseLineId || '—'}{g.sizeLabel ? ` (${g.sizeLabel})` : ''}</td>
                          <td className="px-4 py-2 text-right font-semibold text-orange-700">{g.rowCount}</td>
                          <td className="px-4 py-2 text-right">{fmt(g.netQty)}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{g.latestEntryDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500">
        <p>After reconciling, visit the <Link href="/reports/stock-statement" className="text-blue-600 hover:underline">Stock Statement</Link> to verify the corrected figures.</p>
      </div>
    </div>
  )
}
