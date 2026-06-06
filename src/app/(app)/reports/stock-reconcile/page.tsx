'use client'

import { useState } from 'react'
import Link from 'next/link'

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
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Reconciliation failed'); return }
      setResult(data)
    } catch {
      setError('Network error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
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

      <div className="text-sm text-gray-500">
        <p>After reconciling, visit the <Link href="/reports/stock-statement" className="text-blue-600 hover:underline">Stock Statement</Link> to verify the corrected figures.</p>
      </div>
    </div>
  )
}
