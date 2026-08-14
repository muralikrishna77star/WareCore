'use client'

import { Fragment, useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import RowEditor, { type StagingRow } from './RowEditor'
import { MASTER_QUERIES, type MasterData } from './masterData'
import type { RowError } from '@/lib/purchaseImport/types'

interface Batch {
  id: string
  batch_number: string
  file_name: string
  status: string
  row_count: string
}

interface Counts {
  total: number
  valid: number
  reviewed: number
  readyToImport: boolean
}

interface ImportResultBill {
  id: string
  billNumber: string
  companyLabel: string
  warehouseLabel: string
  supplierLabel: string
  billDate: string
  lineCount: number
  totalQuantity: number
  totalAmount: number
}

const STATUS_COLOR: Record<string, string> = {
  STAGED: 'bg-amber-100 text-amber-800',
  IMPORTED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

function formatDisplayDate(date: string | null | undefined): string {
  if (!date) return '—'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getItemDisplay(row: StagingRow): string {
  const code = row.resolved_field_ids?.materialTypeCode ?? row.current_data.materialType
  const name = row.resolved_field_ids?.materialTypeLabel ?? row.current_data.materialType
  const size = row.current_data.size
  const parts = [code, name].filter(Boolean)
  if (size) parts.push(size)
  return parts.length ? parts.join(' • ') : '—'
}

export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const router = useRouter()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [rows, setRows] = useState<StagingRow[]>([])
  const [batchWarnings, setBatchWarnings] = useState<RowError[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'invalid' | 'unreviewed'>('all')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewAllMessage, setReviewAllMessage] = useState('')
  const [importResult, setImportResult] = useState<{ bills: ImportResultBill[]; totalBills: number; totalLines: number; totalQuantity: number; totalAmount: number } | null>(null)

  const loadBatch = useCallback(async () => {
    const res = await fetch(`/api/bills/import/batches/${batchId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
    setBatch(data.batch)
    setRows(data.rows)
    setBatchWarnings(data.batchWarnings ?? [])
    setCounts(data.counts)
  }, [batchId])

  // Refreshes just one master list — used both for the initial load and by
  // RowEditor's per-field "↻" refresh icon / after its "+ Add New" dialogs.
  const refreshMasterField = useCallback(async (type: keyof MasterData) => {
    const [query, key] = MASTER_QUERIES[type]
    const res = await hasuraFetch<Record<string, unknown[]>>(query)
    const list = (res.data?.[key] as MasterData[typeof type]) ?? []
    setMasterData((prev) => (prev ? { ...prev, [type]: list } : prev))
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      const entries = Object.entries(MASTER_QUERIES) as [keyof MasterData, readonly [string, string]][]
      const results = await Promise.all(entries.map(([, [query]]) => hasuraFetch<Record<string, unknown[]>>(query)))
      const initial: Record<string, unknown[]> = {}
      entries.forEach(([type, [, key]], i) => {
        initial[type] = results[i].data?.[key] ?? []
      })
      setMasterData(initial as unknown as MasterData)
      await loadBatch()
      setLoading(false)
    })()
  }, [loadBatch])

  const toggleReview = async (row: StagingRow) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/rows/${row.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: !row.reviewed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      await loadBatch()
    } finally {
      setBusy(false)
    }
  }

  const reviewAllValid = async () => {
    setBusy(true)
    setError('')
    setReviewAllMessage('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/rows/review-all-valid`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      setReviewAllMessage(
        data.reviewedCount > 0 ? `Marked ${data.reviewedCount} row${data.reviewedCount === 1 ? '' : 's'} reviewed.` : 'No unreviewed valid rows to mark — every valid row is already reviewed.'
      )
      await loadBatch()
    } finally {
      setBusy(false)
    }
  }

  const cancelBatch = async () => {
    if (!window.confirm('Cancel this import batch? Staged rows are kept for reference but nothing will be imported.')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      await loadBatch()
    } finally {
      setBusy(false)
    }
  }

  const deleteBatch = async () => {
    if (!batch) return
    if (!window.confirm(`Delete batch ${batch.batch_number}? This permanently removes it and its staged rows so you can re-upload a fixed file. This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      router.push('/bills/import')
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!window.confirm('Import this batch now? This posts directly to stock and cannot be undone from this screen.')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/import`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
        await loadBatch() // rows may have been re-validated/marked unreviewed — reflect that
        return
      }
      setImportResult(data)
      await loadBatch()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>
  if (!batch || !counts || !masterData) return <p className="text-sm text-red-600">{error || 'Batch not found'}</p>

  const visibleRows = rows.filter((r) => {
    if (filter === 'invalid') return !r.is_valid
    if (filter === 'unreviewed') return !r.reviewed
    return true
  })
  const importedBills = importResult?.bills ?? []

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[1.4375rem] font-bold text-gray-900">{batch.batch_number}</h1>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[batch.status] ?? 'bg-gray-100'}`}>{batch.status}</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">{batch.file_name} · {counts.valid}/{counts.total} valid · {counts.reviewed}/{counts.total} reviewed</p>
        </div>
        <Link href="/bills/import" className="text-sm text-blue-600 underline hover:no-underline">Back to import batches</Link>
      </div>

      {importResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-900">
            Imported {importResult.totalBills} bill{importResult.totalBills === 1 ? '' : 's'}, {importResult.totalLines} line{importResult.totalLines === 1 ? '' : 's'} — Qty {importResult.totalQuantity}, ₹{importResult.totalAmount.toLocaleString('en-IN')}.
          </p>
          <ul className="text-sm text-green-800 space-y-0.5">
            {importResult.bills.map((b) => (
              <li key={b.id}><Link href={`/bills/${b.id}`} className="underline hover:no-underline font-medium">{b.billNumber}</Link> — {b.companyLabel} / {b.warehouseLabel} / {b.supplierLabel}</li>
            ))}
          </ul>
        </div>
      )}

      {batch.status === 'STAGED' && !importResult && (
        <>
          {batchWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Possible duplicate lines (won&apos;t block review, but will block Import):</p>
              <ul className="mt-1 text-sm text-amber-800">
                {batchWarnings.map((w, i) => <li key={i}>Row {w.rowNumber}: {w.message}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={reviewAllValid} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              Mark all valid rows reviewed
            </button>
            <button type="button" disabled={busy} onClick={cancelBatch} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              Cancel batch
            </button>
            <button type="button" disabled={busy} onClick={deleteBatch} className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
              Delete batch
            </button>
            <button
              type="button"
              disabled={busy || !counts.readyToImport}
              onClick={runImport}
              title={!counts.readyToImport ? 'Every row must be valid and reviewed first' : undefined}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Import batch
            </button>
            {!counts.readyToImport && <span className="text-xs text-gray-500">Every row must be valid and reviewed before importing.</span>}
          </div>
          {reviewAllMessage && <p className="text-xs text-green-700">{reviewAllMessage}</p>}

          <div className="flex gap-2 text-xs">
            {(['all', 'invalid', 'unreviewed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 font-medium ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {f === 'all' ? `All (${rows.length})` : f === 'invalid' ? `Invalid (${rows.filter((r) => !r.is_valid).length})` : `Unreviewed (${rows.filter((r) => !r.reviewed).length})`}
              </button>
            ))}
          </div>
        </>
      )}

      {batch.status === 'CANCELLED' && !importResult && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={deleteBatch} className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
            Delete batch
          </button>
          <span className="text-xs text-gray-500">This batch is cancelled — delete it to clear it from the list, or leave it for reference.</span>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase text-gray-500 border-b bg-gray-50">
              <th className="px-4 py-2 text-left">Row</th>
              <th className="px-4 py-2 text-left">Purchase Ref</th>
              <th className="px-4 py-2 text-left">Item Code / Name</th>
              <th className="px-4 py-2 text-left">Purchase Date</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Reviewed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                >
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{row.row_number}</td>
                  <td className="px-4 py-2 text-gray-700">{row.current_data.billRef || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{getItemDisplay(row)}</td>
                  <td className="px-4 py-2 text-gray-700">{formatDisplayDate(row.current_data.billDate)}</td>
                  <td className="px-4 py-2 text-right">{row.current_data.quantity ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{row.current_data.rate ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${row.is_valid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {row.is_valid ? 'Valid' : `${row.validation_errors.length} error${row.validation_errors.length === 1 ? '' : 's'}`}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {batch.status === 'STAGED' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); toggleReview(row) }}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.reviewed ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {row.reviewed ? 'Reviewed' : 'Mark reviewed'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">{row.reviewed ? 'Reviewed' : '—'}</span>
                    )}
                  </td>
                </tr>
                {expandedRowId === row.id && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      {batch.status === 'STAGED' ? (
                        <RowEditor batchId={batchId} row={row} masterData={masterData} onChanged={loadBatch} onRefreshMasterData={refreshMasterField} />
                      ) : (
                        <div className="border-t bg-gray-50 p-4 text-sm text-gray-700 space-y-2">
                          <p className="font-medium text-gray-800">This batch is imported — full purchase details can be viewed below.</p>
                          {importedBills.length > 0 ? (
                            <ul className="space-y-1">
                              {importedBills.map((b) => (
                                <li key={b.id}>
                                  <Link href={`/bills/${b.id}`} className="font-medium text-blue-600 underline hover:no-underline">
                                    {b.billNumber}
                                  </Link>
                                  {' '}— {b.companyLabel} / {b.warehouseLabel} / {b.supplierLabel}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-gray-500">Rows are read-only after import. Use the Bills list to open the imported purchase.</p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
