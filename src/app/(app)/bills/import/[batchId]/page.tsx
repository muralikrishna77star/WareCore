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
  /** Rows that will be imported — skipped rows are not counted here. */
  total: number
  valid: number
  reviewed: number
  skipped: number
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
  const [filter, setFilter] = useState<'all' | 'invalid' | 'unreviewed' | 'skipped'>('all')
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewAllMessage, setReviewAllMessage] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importResult, setImportResult] = useState<{ bills: ImportResultBill[]; totalBills: number; totalLines: number; totalQuantity: number; totalAmount: number; skippedRows?: number } | null>(null)

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

  // Skip (leave out of the import) or bring back one or more rows.
  const setExcluded = async (rowIds: string[], excluded: boolean) => {
    if (rowIds.length === 0) return
    let reason: string | null = null
    if (excluded) {
      reason = window.prompt(
        `Skip ${rowIds.length} row${rowIds.length === 1 ? '' : 's'}? Skipped rows stay in this batch for reference but will NOT be imported.\n\nReason (optional):`,
        ''
      )
      if (reason === null) return // cancelled
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/rows/exclude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds, excluded, reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      setSelected(new Set())
      await loadBatch()
    } finally {
      setBusy(false)
    }
  }

  const toggleSelected = (rowId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })

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
    const skippedNote = counts && counts.skipped > 0
      ? `\n\n${counts.skipped} skipped row${counts.skipped === 1 ? '' : 's'} will NOT be imported.`
      : ''
    if (!window.confirm(`Import ${counts?.total ?? ''} row${counts?.total === 1 ? '' : 's'} now? This posts directly to stock and cannot be undone from this screen.${skippedNote}`)) return
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

  // Invalid / Unreviewed list only rows that will be imported; skipped rows
  // have their own filter.
  const visibleRows = rows.filter((r) => {
    if (filter === 'invalid') return !r.excluded && !r.is_valid
    if (filter === 'unreviewed') return !r.excluded && !r.reviewed
    if (filter === 'skipped') return r.excluded
    return true
  })
  const isStaged = batch.status === 'STAGED' && !importResult
  const selectedRows = rows.filter((r) => selected.has(r.id))
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))

  // Import resolves lines against material_type/material_size only (no
  // item_master FK captured on the line itself) — this is a display-only
  // lookup for an Item Code that happens to already exist for that combo.
  const itemCodeFor = (row: StagingRow): string | null => {
    const typeId = row.resolved_field_ids?.materialTypeId
    if (!typeId) return null
    const sizeId = row.resolved_field_ids?.materialSizeId ?? null
    const match = masterData.items.find((i) => i.material_type_id === typeId && i.material_size_id === sizeId)
    return match?.item_code ?? null
  }

  return (
    <div className="space-y-6 w-full max-w-[1920px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[1.4375rem] font-bold text-gray-900">{batch.batch_number}</h1>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[batch.status] ?? 'bg-gray-100'}`}>{batch.status}</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {batch.file_name} · {counts.valid}/{counts.total} valid · {counts.reviewed}/{counts.total} reviewed
            {counts.skipped > 0 && <> · <span className="font-medium text-gray-700">{counts.skipped} skipped (not imported)</span></>}
          </p>
        </div>
        <Link href="/bills/import" className="text-sm text-blue-600 underline hover:no-underline">Back to import batches</Link>
      </div>

      {importResult && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-900">
            Imported {importResult.totalBills} bill{importResult.totalBills === 1 ? '' : 's'}, {importResult.totalLines} line{importResult.totalLines === 1 ? '' : 's'} — Qty {importResult.totalQuantity}, ₹{importResult.totalAmount.toLocaleString('en-IN')}.
            {!!importResult.skippedRows && ` ${importResult.skippedRows} skipped row${importResult.skippedRows === 1 ? ' was' : 's were'} not imported.`}
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
              <p className="text-sm font-semibold text-amber-900">Possible duplicate lines (won&apos;t block review or Import — double-check these aren&apos;t copy-paste mistakes):</p>
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
              title={!counts.readyToImport ? 'Every row that isn\'t skipped must be valid and reviewed first' : undefined}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Import batch
            </button>
            {!counts.readyToImport && (
              <span className="text-xs text-gray-500">
                {counts.total === 0
                  ? 'Every row is skipped — include at least one row to import.'
                  : 'Every row must be valid and reviewed before importing — or skip the rows you don\'t want to import.'}
              </span>
            )}
          </div>
          {reviewAllMessage && <p className="text-xs text-green-700">{reviewAllMessage}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex gap-2">
              {(['all', 'invalid', 'unreviewed', 'skipped'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 font-medium ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {f === 'all' ? `All (${rows.length})`
                    : f === 'invalid' ? `Invalid (${rows.filter((r) => !r.excluded && !r.is_valid).length})`
                    : f === 'unreviewed' ? `Unreviewed (${rows.filter((r) => !r.excluded && !r.reviewed).length})`
                    : `Skipped (${rows.filter((r) => r.excluded).length})`}
                </button>
              ))}
            </div>
            {selectedRows.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
                <span className="font-medium text-gray-700">{selectedRows.length} selected</span>
                <button
                  type="button"
                  disabled={busy || selectedRows.every((r) => r.excluded)}
                  onClick={() => setExcluded(selectedRows.filter((r) => !r.excluded).map((r) => r.id), true)}
                  className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Skip selected
                </button>
                <button
                  type="button"
                  disabled={busy || selectedRows.every((r) => !r.excluded)}
                  onClick={() => setExcluded(selectedRows.filter((r) => r.excluded).map((r) => r.id), false)}
                  className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Include selected
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Clear</button>
              </div>
            )}
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
              {isStaged && (
                <th className="pl-4 py-2 w-6">
                  <input
                    type="checkbox"
                    aria-label="Select every row shown"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        for (const r of visibleRows) {
                          if (allVisibleSelected) next.delete(r.id)
                          else next.add(r.id)
                        }
                        return next
                      })
                    }
                  />
                </th>
              )}
              <th className="px-4 py-2 text-left">Row</th>
              <th className="px-4 py-2 text-left">Purchase Ref</th>
              <th className="px-4 py-2 text-left">Purchase Date</th>
              <th className="px-4 py-2 text-left">Company / Warehouse / Supplier</th>
              <th className="px-4 py-2 text-left">Item Code</th>
              <th className="px-4 py-2 text-left">Material</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Rate</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">{isStaged ? 'Reviewed / Skip' : 'Reviewed'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={`hover:bg-gray-50 cursor-pointer ${row.excluded ? 'bg-gray-50/80 text-gray-400' : ''}`}
                  onClick={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                >
                  {isStaged && (
                    <td className="pl-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select row ${row.row_number - 1}`} checked={selected.has(row.id)} onChange={() => toggleSelected(row.id)} />
                    </td>
                  )}
                  {/* row_number is the literal Excel row (header = row 1), kept as-is
                      in error/duplicate messages so it maps to the source file — here
                      it's shown as a plain 1-based count of data rows. */}
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">{row.row_number - 1}</td>
                  <td className="px-4 py-2 text-gray-700">{row.purchase_bill_number || row.current_data.billRef || '—'}</td>
                  <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{row.current_data.billDate || '—'}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {row.resolved_field_ids?.companyLabel ?? row.current_data.company} / {row.resolved_field_ids?.warehouseLabel ?? row.current_data.warehouse} / {row.resolved_field_ids?.supplierLabel ?? row.current_data.supplier}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{itemCodeFor(row) ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{row.resolved_field_ids?.materialTypeLabel ?? row.current_data.materialType}{row.current_data.size ? ` - ${row.current_data.size}` : ''}</td>
                  <td className="px-4 py-2 text-right">{row.current_data.quantity ?? '—'}</td>
                  <td className="px-4 py-2 text-right">{row.current_data.rate ?? '—'}</td>
                  <td className="px-4 py-2">
                    {row.excluded ? (
                      <span
                        className="inline-flex rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-600"
                        title={row.exclusion_reason ? `Reason: ${row.exclusion_reason}` : 'Skipped — will not be imported'}
                      >
                        Skipped
                      </span>
                    ) : (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${row.is_valid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {row.is_valid ? 'Valid' : `${row.validation_errors.length} error${row.validation_errors.length === 1 ? '' : 's'}`}
                      </span>
                    )}
                    {row.excluded && row.exclusion_reason && (
                      <span className="mt-0.5 block max-w-[14rem] truncate text-[11px] text-gray-500" title={row.exclusion_reason}>{row.exclusion_reason}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {batch.status === 'STAGED' && row.excluded ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setExcluded([row.id], false) }}
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                        title="Bring this row back into the import"
                      >
                        Include again
                      </button>
                    ) : batch.status === 'STAGED' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); toggleReview(row) }}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.reviewed ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}`}
                        >
                          {row.reviewed ? 'Reviewed' : 'Mark reviewed'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); setExcluded([row.id], true) }}
                          className="ml-2 text-xs font-medium text-gray-500 hover:text-red-600 hover:underline"
                          title="Leave this row out of the import"
                        >
                          Skip
                        </button>
                      </>
                    ) : row.excluded ? (
                      <span className="text-xs text-gray-500">Not imported (skipped)</span>
                    ) : row.purchase_bill_id ? (
                      <Link
                        href={`/bills/${row.purchase_bill_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-200"
                        title="Open the full purchase bill this row was imported into"
                      >
                        View Purchase →
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">{row.reviewed ? 'Reviewed' : '—'}</span>
                    )}
                  </td>
                </tr>
                {expandedRowId === row.id && (
                  <tr>
                    <td colSpan={isStaged ? 11 : 10} className="p-0">
                      {batch.status === 'STAGED' ? (
                        <RowEditor batchId={batchId} row={row} masterData={masterData} onChanged={loadBatch} onRefreshMasterData={refreshMasterField} />
                      ) : row.purchase_bill_id ? (
                        <div className="border-t bg-gray-50 p-4 text-sm text-gray-600">
                          This batch is {batch.status.toLowerCase()} — rows can no longer be edited.{' '}
                          <Link href={`/bills/${row.purchase_bill_id}`} className="text-blue-600 underline hover:no-underline">
                            View the full purchase bill this row was imported into →
                          </Link>
                        </div>
                      ) : (
                        <div className="border-t bg-gray-50 p-4 text-sm text-gray-500">This batch is {batch.status.toLowerCase()} — rows can no longer be edited.</div>
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
