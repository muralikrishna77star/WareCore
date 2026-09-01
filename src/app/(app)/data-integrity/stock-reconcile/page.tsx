'use client'

import { Fragment, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ChevronDown, Search, Copy, Check } from 'lucide-react'
import { ProfessionalExportButton } from '@/components/ProfessionalExportButton'
import { QTY_FMT, MONEY_FMT, type ProfessionalSheetSpec } from '@/lib/exportProfessionalExcel'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

type TotalRow = {
  category: string
  sourceQty: number
  ledgerQty: number
  diff: number
  matches: boolean
  explainedQty: number
  explainedCount: number
  fullyExplained: boolean
}
type StaleRecord = {
  id: string
  entryType: string
  referenceType: string
  referenceNumber: string | null
  quantity: number
  entryDate: string
  materialCode: string | null
  sizeLabel: string | null
  rate: number | null
}
type ExplainedRecord = {
  category: string
  cancellationId: string
  referenceNumber: string | null
  qty: number
  cancelledDate: string
  url: string
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
  rate: number | null
}
type ItemReconcileResult = {
  id: string
  itemCode: string
  itemName: string
  unit: string
  openingBalance: number
  closingBalance: number
  vendorOpeningBalance: number
  vendorClosingBalance: number
  vendorExpected: number | null
  minBalance: number
  minVendorBalance: number
  txnCount: number
  valid: boolean
  reasons: string[]
}
type DiagnosisFinding = {
  pattern: 'missing_transfer_leg' | 'purchase_variance' | 'phantom_return' | 'transfer_timing_false_positive'
  title: string
  detail: string
}
type DiagnosisResult = {
  itemCode: string
  itemName: string
  closingBalance: number
  vendorClosingBalance: number
  vendorExpected: number
  findings: DiagnosisFinding[]
}

const categoryLabels: Record<string, string> = {
  purchases: 'Purchases',
  sales: 'Sales / Dispatch',
  job_work: 'Job Work (Out)',
  purchase_cancellations: 'Purchase Cancellations',
  sale_cancellations: 'Sale Cancellations',
  job_work_cancellations: 'Job Work Cancellations',
}

// Cancellation archive totals can legitimately drift from the ledger in both
// directions (mid-edit reversals inflate the ledger; orphaned rows deleted
// after a pre-054 purge inflate the archive) — see the caveat text below the
// table. Flag these as informational rather than a red "Mismatch" alarm.
const cancellationCategories = new Set(['purchase_cancellations', 'sale_cancellations', 'job_work_cancellations'])

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export default function StockReconcilePage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ reconciled: number } | null>(null)
  const [error, setError] = useState('')

  const runReconcile = async () => {
    const ok = window.confirm(
      'This will INSERT correcting PURCHASE_CANCEL entries directly into the stock ledger for any phantom purchase-line balances found. This is a write action, not a check — it cannot be previewed or undone from here. Continue?'
    )
    if (!ok) return
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/stock/reconcile', { method: 'POST' })
      let data: { error?: string; reconciled?: number } = {}
      try { data = await res.json() } catch { data = {} }
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      setResult({ reconciled: data.reconciled ?? 0 })
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
  const [explainedRecords, setExplainedRecords] = useState<ExplainedRecord[] | null>(null)
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
    setExplainedRecords(null)
    setStaleRecords(null)
    setDuplicateGroups(null)
    try {
      const res = await fetch(`/api/stock/verify?from=${from}&to=${to}`)
      const data = await res.json()
      if (!res.ok) { setVerifyError(data.error || `Server error (${res.status})`); return }
      setTotals(data.totals)
      setExplainedRecords(data.explainedRecords)
      setStaleRecords(data.staleRecords)
      setDuplicateGroups(data.duplicateGroups)
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setVerifying(false)
    }
  }

  const fmt = (n: number) => n.toFixed(3)

  const totalsSort = useTableSort(totals ?? [], {
    category: (r) => categoryLabels[r.category] || r.category,
    sourceQty: (r) => r.sourceQty,
    ledgerQty: (r) => r.ledgerQty,
    diff: (r) => r.diff,
    status: (r) => (r.matches ? 'Match' : cancellationCategories.has(r.category) || r.fullyExplained ? 'Info' : 'Mismatch'),
  })
  const explainedSort = useTableSort(explainedRecords ?? [], {
    category: (r) => categoryLabels[r.category] || r.category,
    reference: (r) => r.referenceNumber ?? '',
    qty: (r) => r.qty,
    cancelled_date: (r) => r.cancelledDate,
  })
  const staleSort = useTableSort(staleRecords ?? [], {
    date: (r) => r.entryDate,
    type: (r) => r.entryType,
    reference: (r) => r.referenceNumber ?? '',
    material: (r) => `${r.materialCode ?? ''}${r.sizeLabel ? ` (${r.sizeLabel})` : ''}`,
    qty: (r) => r.quantity,
  })
  const duplicatesSort = useTableSort(duplicateGroups ?? [], {
    reference: (g) => g.referenceNumber ?? '',
    type: (g) => g.entryType,
    line: (g) => `${g.purchaseLineId ?? ''}${g.sizeLabel ? ` (${g.sizeLabel})` : ''}`,
    rows: (g) => g.rowCount,
    net_qty: (g) => g.netQty,
    latest_date: (g) => g.latestEntryDate,
  })

  // ── Item-by-item reconciliation: walks every active item's opening ->
  // transactions -> closing balance for a date range, in visible batches,
  // marking each item valid or flagging it as it's checked. ──────────────
  const [itemFrom, setItemFrom] = useState(`${currentYear}-01-01`)
  const [itemTo, setItemTo] = useState(todayStr())
  const [itemRunning, setItemRunning] = useState(false)
  const [itemError, setItemError] = useState('')
  const [itemResults, setItemResults] = useState<ItemReconcileResult[]>([])
  const [itemProgress, setItemProgress] = useState({ done: 0, total: 0 })
  const [itemCurrentBatch, setItemCurrentBatch] = useState('')
  const [showOnlyIssues, setShowOnlyIssues] = useState(false)
  const itemStopRef = useRef(false)

  // ── Review & Fix diagnosis panel: detects known root-cause patterns for a
  // mismatched item (read-only — no writes) so the user can decide what to
  // do without a manual investigation each time. ──────────────────────────
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [diagnoses, setDiagnoses] = useState<Record<string, DiagnosisResult | 'loading' | 'error'>>({})

  const toggleDiagnosis = async (id: string) => {
    if (expandedItemId === id) { setExpandedItemId(null); return }
    setExpandedItemId(id)
    if (diagnoses[id]) return
    setDiagnoses((prev) => ({ ...prev, [id]: 'loading' }))
    try {
      const res = await fetch(`/api/stock/reconcile-items/diagnose?id=${id}`)
      const data = await res.json()
      if (!res.ok) { setDiagnoses((prev) => ({ ...prev, [id]: 'error' })); return }
      setDiagnoses((prev) => ({ ...prev, [id]: data as DiagnosisResult }))
    } catch {
      setDiagnoses((prev) => ({ ...prev, [id]: 'error' }))
    }
  }

  // ── Copy-to-clipboard for a mismatched row: formats the same figures an
  // investigation prompt needs (item, date range, balances, reasons, and
  // whatever diagnosis has already run) so it can be pasted straight in. ──
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null)

  const buildCopyText = (r: ItemReconcileResult): string => {
    const diagnosis = diagnoses[r.id]
    const lines = [
      `Reconciliation mismatch — ${r.itemCode} (${r.itemName})`,
      `Date range: ${itemFrom} to ${itemTo}`,
      `Opening: ${fmt(r.openingBalance)}   Closing: ${fmt(r.closingBalance)}`,
      `Vendor Closing: ${fmt(r.vendorClosingBalance)}   Vendor Expected: ${r.vendorExpected === null ? '—' : fmt(r.vendorExpected)}`,
      'Reasons:',
      ...r.reasons.map((reason) => `- ${reason}`),
    ]
    if (diagnosis && diagnosis !== 'loading' && diagnosis !== 'error') {
      lines.push('', 'Diagnosis findings:')
      lines.push(...(diagnosis.findings.length
        ? diagnosis.findings.map((f) => `- [${f.pattern}] ${f.title}: ${f.detail}`)
        : ['- No known pattern matched automatically.']))
    }
    return lines.join('\n')
  }

  const handleCopyRow = (r: ItemReconcileResult) => {
    navigator.clipboard.writeText(buildCopyText(r))
    setCopiedRowId(r.id)
    setTimeout(() => setCopiedRowId((id) => (id === r.id ? null : id)), 1500)
  }

  const validCount = itemResults.filter((r) => r.valid).length
  const mismatchCount = itemResults.length - validCount
  const preSortResults = showOnlyIssues ? itemResults.filter((r) => !r.valid) : itemResults
  const itemResultsSort = useTableSort(preSortResults, {
    item: (r) => r.itemCode,
    opening: (r) => r.openingBalance,
    closing: (r) => r.closingBalance,
    vendor_closing: (r) => r.vendorClosingBalance,
    vendor_expected: (r) => r.vendorExpected,
    status: (r) => (r.valid ? 1 : 0),
  })
  const visibleResults = itemResultsSort.sortedRows

  const runItemReconcile = async () => {
    setItemRunning(true)
    setItemError('')
    setItemResults([])
    setItemProgress({ done: 0, total: 0 })
    itemStopRef.current = false
    const limit = 100
    let offset = 0
    let total = Infinity
    try {
      while (offset < total) {
        if (itemStopRef.current) break
        const res = await fetch(`/api/stock/reconcile-items?from=${itemFrom}&to=${itemTo}&offset=${offset}&limit=${limit}`)
        const data = await res.json()
        if (!res.ok) { setItemError(data.error || `Server error (${res.status})`); break }
        const batch: ItemReconcileResult[] = data.items ?? []
        total = data.totalCount ?? 0
        if (batch.length === 0) break
        setItemCurrentBatch(`${batch[0].itemCode} – ${batch[batch.length - 1].itemCode}`)
        setItemResults((prev) => [...prev, ...batch])
        offset += batch.length
        setItemProgress({ done: offset, total })
      }
    } catch (err) {
      setItemError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setItemRunning(false)
      setItemCurrentBatch('')
    }
  }

  const stopItemReconcile = () => { itemStopRef.current = true }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">Fix phantom stock entries caused by bill edits</p>
        </div>
        <Link href="/reports/stock-statement" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Stock Statement
        </Link>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <span className="font-semibold">Legacy reconciliation tool</span> — see the{' '}
        <Link href="/data-integrity" className="underline font-medium">Dashboard</Link>,{' '}
        <Link href="/data-integrity/runs" className="underline font-medium">Reconciliation Runs</Link>, and{' '}
        <Link href="/data-integrity/exceptions" className="underline font-medium">Exception Workbench</Link> above
        for comprehensive, read-only validation across purchases, sales, transfers, and job work, with a
        persistent exception history and no direct writes. The tools below remain available for the specific
        phantom-purchase-line check they were built for, but &quot;Run Reconciliation&quot; below writes directly
        to the stock ledger — it is not the same as &quot;Verify&quot; underneath it, which only reads.
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
            {running ? 'Writing to ledger…' : 'Run Reconciliation (writes to ledger)'}
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
            <div className="flex justify-end">
              <ProfessionalExportButton
                meta={{ companyName: 'All Companies', fromDate: from, toDate: to, filterLine: `Year: ${year === 'all' ? 'All Time' : year}`, generatedBy: '' }}
                sheets={[{
                  sheetName: 'Totals',
                  title: 'Stock Reconciliation — Totals',
                  emptyMessage: 'No totals to display.',
                  columns: [
                    { header: 'Category', key: 'category', width: 24, align: 'left' },
                    { header: 'Source Total', key: 'sourceQty', width: 16, align: 'right', numFmt: QTY_FMT },
                    { header: 'Ledger Total', key: 'ledgerQty', width: 16, align: 'right', numFmt: QTY_FMT },
                    { header: 'Diff', key: 'diff', width: 14, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
                    { header: 'Status', key: 'status', width: 14, align: 'center' },
                  ],
                  rows: totals.map((row) => ({
                    category: categoryLabels[row.category] || row.category,
                    sourceQty: row.sourceQty,
                    ledgerQty: row.ledgerQty,
                    diff: row.diff,
                    status: row.matches ? 'Match' : cancellationCategories.has(row.category) ? 'Info' : 'Mismatch',
                  })),
                } satisfies ProfessionalSheetSpec]}
                filenameBase="Stock_Reconcile_Totals"
                label="Export"
                successMessage="Totals exported successfully."
                errorMessage="Unable to export. Please try again."
              />
            </div>
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left">
                    <SortableTh label="Category" sortKey="category" activeKey={totalsSort.sortKey} dir={totalsSort.sortDir} onSort={totalsSort.toggleSort} />
                    <SortableTh label="Source Total" sortKey="sourceQty" activeKey={totalsSort.sortKey} dir={totalsSort.sortDir} onSort={totalsSort.toggleSort} align="right" />
                    <SortableTh label="Ledger Total" sortKey="ledgerQty" activeKey={totalsSort.sortKey} dir={totalsSort.sortDir} onSort={totalsSort.toggleSort} align="right" />
                    <SortableTh label="Diff" sortKey="diff" activeKey={totalsSort.sortKey} dir={totalsSort.sortDir} onSort={totalsSort.toggleSort} align="right" />
                    <SortableTh label="Status" sortKey="status" activeKey={totalsSort.sortKey} dir={totalsSort.sortDir} onSort={totalsSort.toggleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {totalsSort.sortedRows.map((row) => {
                    const isInfoOnly = !row.matches && (cancellationCategories.has(row.category) || row.fullyExplained)
                    return (
                      <tr key={row.category}>
                        <td className="px-4 py-2 font-medium text-gray-900">{categoryLabels[row.category] || row.category}</td>
                        <td className="px-4 py-2 text-right">{fmt(row.sourceQty)}</td>
                        <td className="px-4 py-2 text-right">{fmt(row.ledgerQty)}</td>
                        <td className={`px-4 py-2 text-right font-medium ${row.matches ? 'text-gray-500' : isInfoOnly ? 'text-amber-600' : 'text-red-600'}`}>
                          {fmt(row.diff)}
                        </td>
                        <td className="px-4 py-2">
                          {row.matches ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Match</span>
                          ) : isInfoOnly ? (
                            <span
                              className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                              title={
                                row.fullyExplained
                                  ? `Fully explained: ${row.explainedCount} order(s) dispatched in this window were deleted/cancelled outside it.`
                                  : undefined
                              }
                            >
                              {row.fullyExplained ? 'Explained' : 'Info'}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Mismatch</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500">
              Purchase/Sale Cancellation rows can legitimately differ from the ledger total — a mid-edit
              stock reversal creates the same PURCHASE_CANCEL / SALE_CANCEL entry type as a full order
              cancellation, so the ledger total may run higher than the cancelled-order archive total.
              Job Work Cancellations no longer post a ledger entry at all (the order&apos;s ledger rows are
              removed outright on cancellation) — that row is archive-side reporting only, not a reconciliation check.
            </p>
          </div>
        )}

        {explainedRecords && explainedRecords.length > 0 && (
          <div className="border-t pt-4">
            <h3 className="font-medium text-gray-900 mb-1">
              Residuals Explained by Later Cancellations <span className="text-amber-600">({explainedRecords.length})</span>
            </h3>
            <p className="text-sm text-gray-600 mb-2">
              These orders were dispatched/billed inside the selected window but deleted or cancelled
              outside it, so their original ledger entry stays here as history with no live source row to
              match it. Open one to verify manually.
            </p>
            <div className="overflow-auto max-h-80 rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b text-left">
                    <SortableTh label="Category" sortKey="category" activeKey={explainedSort.sortKey} dir={explainedSort.sortDir} onSort={explainedSort.toggleSort} />
                    <SortableTh label="Reference" sortKey="reference" activeKey={explainedSort.sortKey} dir={explainedSort.sortDir} onSort={explainedSort.toggleSort} />
                    <SortableTh label="Qty" sortKey="qty" activeKey={explainedSort.sortKey} dir={explainedSort.sortDir} onSort={explainedSort.toggleSort} align="right" />
                    <SortableTh label="Cancelled On" sortKey="cancelled_date" activeKey={explainedSort.sortKey} dir={explainedSort.sortDir} onSort={explainedSort.toggleSort} />
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {explainedSort.sortedRows.map((r) => (
                    <tr key={r.cancellationId}>
                      <td className="px-4 py-2">{categoryLabels[r.category] || r.category}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.referenceNumber || '—'}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.qty)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{r.cancelledDate}</td>
                      <td className="px-4 py-2 text-right">
                        <Link href={r.url} className="inline-flex items-center gap-1 text-blue-600 hover:underline whitespace-nowrap">
                          View cancellation <ArrowRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {staleRecords && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">
                Stale Records {staleRecords.length > 0 && <span className="text-red-600">({staleRecords.length})</span>}
              </h3>
              {staleRecords.length > 0 && (
                <ProfessionalExportButton
                  meta={{ companyName: 'All Companies', fromDate: from, toDate: to, filterLine: `Year: ${year === 'all' ? 'All Time' : year}`, generatedBy: '' }}
                  sheets={[{
                    sheetName: 'Stale Records',
                    title: 'Stock Reconciliation — Stale Records',
                    emptyMessage: 'No stale records found.',
                    columns: [
                      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
                      { header: 'Transaction Date', key: 'date', width: 16, align: 'center', isDate: true },
                      { header: 'Type', key: 'type', width: 18, align: 'left' },
                      { header: 'Reference', key: 'reference', width: 18, align: 'left' },
                      { header: 'Material', key: 'material', width: 24, align: 'left' },
                      { header: 'Qty', key: 'qty', width: 12, align: 'right', numFmt: QTY_FMT },
                      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
                    ],
                    rows: staleRecords.map((r, idx) => ({
                      sno: idx + 1,
                      date: r.entryDate,
                      type: r.entryType,
                      reference: r.referenceNumber || '',
                      material: `${r.materialCode ?? ''}${r.sizeLabel ? ` (${r.sizeLabel})` : ''}`,
                      qty: r.quantity,
                      rate: r.rate ?? null,
                    })),
                  } satisfies ProfessionalSheetSpec]}
                  filenameBase="Stock_Reconcile_Stale_Records"
                  label="Export"
                  successMessage="Stale records exported successfully."
                  errorMessage="Unable to export. Please try again."
                />
              )}
            </div>
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
                        <SortableTh label="Date" sortKey="date" activeKey={staleSort.sortKey} dir={staleSort.sortDir} onSort={staleSort.toggleSort} />
                        <SortableTh label="Type" sortKey="type" activeKey={staleSort.sortKey} dir={staleSort.sortDir} onSort={staleSort.toggleSort} />
                        <SortableTh label="Reference" sortKey="reference" activeKey={staleSort.sortKey} dir={staleSort.sortDir} onSort={staleSort.toggleSort} />
                        <SortableTh label="Material" sortKey="material" activeKey={staleSort.sortKey} dir={staleSort.sortDir} onSort={staleSort.toggleSort} />
                        <SortableTh label="Qty" sortKey="qty" activeKey={staleSort.sortKey} dir={staleSort.sortDir} onSort={staleSort.toggleSort} align="right" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {staleSort.sortedRows.map((r) => (
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
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">
                Duplicate Ledger Rows {duplicateGroups.length > 0 && <span className="text-orange-600">({duplicateGroups.length})</span>}
              </h3>
              {duplicateGroups.length > 0 && (
                <ProfessionalExportButton
                  meta={{ companyName: 'All Companies', fromDate: from, toDate: to, filterLine: `Year: ${year === 'all' ? 'All Time' : year}`, generatedBy: '' }}
                  sheets={[{
                    sheetName: 'Duplicates',
                    title: 'Stock Reconciliation — Duplicate Ledger Rows',
                    emptyMessage: 'No duplicate ledger rows found.',
                    columns: [
                      { header: 'S.No.', key: 'sno', width: 8, align: 'center' },
                      { header: 'Reference', key: 'reference', width: 18, align: 'left' },
                      { header: 'Type', key: 'type', width: 18, align: 'left' },
                      { header: 'Line', key: 'line', width: 20, align: 'left' },
                      { header: 'Rows', key: 'rows', width: 10, align: 'right' },
                      { header: 'Net Qty', key: 'netQty', width: 14, align: 'right', numFmt: QTY_FMT },
                      { header: 'Rate (₹)', key: 'rate', width: 12, align: 'right', numFmt: MONEY_FMT },
                      { header: 'Latest Transaction Date', key: 'date', width: 18, align: 'center', isDate: true },
                    ],
                    rows: duplicateGroups.map((g, idx) => ({
                      sno: idx + 1,
                      reference: g.referenceNumber || '',
                      type: g.entryType,
                      line: `${g.purchaseLineId ?? ''}${g.sizeLabel ? ` (${g.sizeLabel})` : ''}`,
                      rows: g.rowCount,
                      netQty: g.netQty,
                      rate: g.rate ?? null,
                      date: g.latestEntryDate,
                    })),
                  } satisfies ProfessionalSheetSpec]}
                  filenameBase="Stock_Reconcile_Duplicates"
                  label="Export"
                  successMessage="Duplicate rows exported successfully."
                  errorMessage="Unable to export. Please try again."
                />
              )}
            </div>
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
                        <SortableTh label="Reference" sortKey="reference" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} />
                        <SortableTh label="Type" sortKey="type" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} />
                        <SortableTh label="Line" sortKey="line" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} />
                        <SortableTh label="Rows" sortKey="rows" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} align="right" />
                        <SortableTh label="Net Qty" sortKey="net_qty" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} align="right" />
                        <SortableTh label="Latest" sortKey="latest_date" activeKey={duplicatesSort.sortKey} dir={duplicatesSort.sortDir} onSort={duplicatesSort.toggleSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {duplicatesSort.sortedRows.map((g, i) => (
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

      <div className="rounded-xl border bg-white p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900 mb-1">Item-by-Item Reconciliation</h2>
          <p className="text-sm text-gray-600">
            For every active item that has at least one stock ledger entry (items never purchased or
            used are skipped): takes its opening stock at the start date, applies every ledger
            transaction up to the end date, and checks the resulting balance never dips negative and —
            when the end date is today — agrees with the vendor-held quantity computed independently from
            job work records. Processes items in visible batches; each one is marked Valid or flagged as it
            completes. Read-only — makes no changes.
          </p>
          <p className="text-sm text-gray-500 mt-2">
            &quot;Review &amp; Fix&quot; on a mismatch opens that item&apos;s Item Stock Ledger, where admin/developer
            accounts can select the specific offending row(s) and delete them (with a confirmation and a
            net-effect warning) — there&apos;s no blind auto-fix here, each mismatch has a different real cause
            and needs a look before anything is changed.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input
              type="date"
              value={itemFrom}
              onChange={(e) => setItemFrom(e.target.value)}
              disabled={itemRunning}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input
              type="date"
              value={itemTo}
              onChange={(e) => setItemTo(e.target.value)}
              disabled={itemRunning}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
            />
          </div>
          {!itemRunning ? (
            <button
              type="button"
              onClick={runItemReconcile}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              Run Reconciliation
            </button>
          ) : (
            <button
              type="button"
              onClick={stopItemReconcile}
              className="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
            >
              Stop
            </button>
          )}
          {itemResults.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-600 ml-auto">
              <input type="checkbox" checked={showOnlyIssues} onChange={(e) => setShowOnlyIssues(e.target.checked)} />
              Show only issues
            </label>
          )}
        </div>

        {itemError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{itemError}</p>
          </div>
        )}

        {(itemRunning || itemResults.length > 0) && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: itemProgress.total ? `${Math.min(100, (itemProgress.done / itemProgress.total) * 100)}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {itemRunning
                    ? `Checking ${itemCurrentBatch || '…'} — ${itemProgress.done} of ${itemProgress.total || '…'} items`
                    : `Checked ${itemProgress.done} of ${itemProgress.total} items`}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                Valid: {validCount}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">
                Mismatch: {mismatchCount}
              </span>
            </div>

            {itemResults.length > 0 && (
              <div className="flex justify-end">
                <ProfessionalExportButton
                  meta={{
                    companyName: 'All Companies',
                    fromDate: itemFrom,
                    toDate: itemTo,
                    filterLine: `${showOnlyIssues ? 'Mismatches only' : 'All items'} — Valid: ${validCount}, Mismatch: ${mismatchCount}`,
                    generatedBy: '',
                  }}
                  sheets={[{
                    sheetName: 'Item Reconciliation',
                    title: 'Item-by-Item Reconciliation',
                    emptyMessage: 'No items to display.',
                    columns: [
                      { header: 'Item Code', key: 'itemCode', width: 16, align: 'left' },
                      { header: 'Item Name', key: 'itemName', width: 28, align: 'left' },
                      { header: 'Unit', key: 'unit', width: 8, align: 'center' },
                      { header: 'Opening', key: 'opening', width: 14, align: 'right', numFmt: QTY_FMT },
                      { header: 'Closing', key: 'closing', width: 14, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
                      { header: 'Vendor Closing', key: 'vendorClosing', width: 16, align: 'right', numFmt: QTY_FMT, negativeWarning: true },
                      { header: 'Vendor Expected', key: 'vendorExpected', width: 16, align: 'right', numFmt: QTY_FMT },
                      { header: 'Status', key: 'status', width: 12, align: 'center' },
                      { header: 'Reasons', key: 'reasons', width: 48, align: 'left' },
                    ],
                    rows: visibleResults.map((r) => ({
                      itemCode: r.itemCode,
                      itemName: r.itemName,
                      unit: r.unit,
                      opening: r.openingBalance,
                      closing: r.closingBalance,
                      vendorClosing: r.vendorClosingBalance,
                      vendorExpected: r.vendorExpected,
                      status: r.valid ? 'Valid' : 'Mismatch',
                      reasons: r.reasons.join('; '),
                    })),
                  } satisfies ProfessionalSheetSpec]}
                  filenameBase="Item_By_Item_Reconciliation"
                  successMessage="Item-by-item reconciliation exported successfully."
                  errorMessage="Unable to export. Please try again."
                />
              </div>
            )}

            <div className="overflow-auto max-h-[32rem] rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b text-left">
                    <SortableTh label="Item" sortKey="item" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} />
                    <SortableTh label="Opening" sortKey="opening" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} align="right" />
                    <SortableTh label="Closing" sortKey="closing" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} align="right" />
                    <SortableTh label="Vendor Closing" sortKey="vendor_closing" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} align="right" />
                    <SortableTh label="Vendor Expected" sortKey="vendor_expected" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} align="right" />
                    <SortableTh label="Status" sortKey="status" activeKey={itemResultsSort.sortKey} dir={itemResultsSort.sortDir} onSort={itemResultsSort.toggleSort} />
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleResults.map((r) => {
                    const diagnosis = diagnoses[r.id]
                    const expanded = expandedItemId === r.id
                    return (
                    <Fragment key={r.id}>
                    <tr className={r.valid ? '' : 'bg-red-50/50'}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{r.itemCode}</div>
                        <div className="text-xs text-gray-500">{r.itemName}</div>
                      </td>
                      <td className="px-4 py-2 text-right">{fmt(r.openingBalance)}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.closingBalance)}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.vendorClosingBalance)}</td>
                      <td className="px-4 py-2 text-right text-gray-500">
                        {r.vendorExpected === null ? '—' : fmt(r.vendorExpected)}
                      </td>
                      <td className="px-4 py-2">
                        {r.valid ? (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Valid</span>
                        ) : (
                          <div>
                            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Mismatch</span>
                            <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                              {r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                            </ul>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {r.valid ? (
                          <Link
                            href={`/reports/item-ledger?item=${r.id}&from=${itemFrom}&to=${itemTo}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            View Ledger <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyRow(r)}
                              title="Copy details to paste into a fix prompt"
                              className="inline-flex items-center rounded-lg border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                            >
                              {copiedRowId === r.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleDiagnosis(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              <Search className="h-3 w-3" /> Review & Fix
                              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-blue-50/40">
                        <td colSpan={7} className="px-4 py-3">
                          {diagnosis === 'loading' ? (
                            <p className="text-xs text-gray-500">Checking known patterns…</p>
                          ) : diagnosis === 'error' || !diagnosis ? (
                            <p className="text-xs text-red-600">Couldn&apos;t run diagnosis. Try again, or open the Item Ledger to investigate manually.</p>
                          ) : diagnosis.findings.length === 0 ? (
                            <div className="text-xs text-gray-600">
                              <p>No known pattern matched automatically — this needs a manual look.</p>
                              <Link
                                href={`/reports/item-ledger?item=${r.id}&from=${itemFrom}&to=${itemTo}`}
                                target="_blank"
                                className="mt-1 inline-flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                Open Item Ledger <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {diagnosis.findings.map((f, i) => (
                                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                  <p className="text-xs font-semibold text-amber-900">{f.title}</p>
                                  <p className="mt-0.5 text-xs text-amber-800">{f.detail}</p>
                                </div>
                              ))}
                              <p className="text-[11px] text-gray-500">
                                Diagnosis only — nothing has been changed. Verify against the physical/paperwork records before making a fix.
                              </p>
                              <Link
                                href={`/reports/item-ledger?item=${r.id}&from=${itemFrom}&to=${itemTo}`}
                                target="_blank"
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                              >
                                Open Item Ledger <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500">
        <p>After reconciling, visit the <Link href="/reports/stock-statement" className="text-blue-600 hover:underline">Stock Statement</Link> to verify the corrected figures.</p>
      </div>
    </div>
  )
}
