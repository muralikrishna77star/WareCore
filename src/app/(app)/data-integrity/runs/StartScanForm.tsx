'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function StartScanForm({ canRun }: { canRun: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [fromDate, setFromDate] = useState('2000-01-01')
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))

  if (!canRun) return null

  const start = async () => {
    setRunning(true)
    setError('')
    try {
      const res = await fetch('/api/data-integrity/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runType: 'MANUAL', scopeType: 'FULL', fromDate, toDate }),
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
      setRunning(false)
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div>
        <p className="font-semibold text-gray-900 text-sm">Start a manual scan</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Read-only. This never changes stock — it only reads stock_ledger and source tables and records what it finds.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run Full Scan'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}
