'use client'

import { Fragment, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatDate, formatDateTime, formatNumber, getEntryTypeLabel } from '@/lib/utils'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ItemLedgerLink, JobWorkLink, PurchaseLineLink } from '@/components/ReportLinks'

export type LedgerDeletionRow = {
  id: string
  stockLedgerId: string
  deletedAt: string
  deletedBy: string | null
  entryType: string
  quantity: number
  sizeLabel: string | null
  entryDate: string | null
  purchaseLineId: string | null
  referenceType: string | null
  /** Set only when the job work order still exists. */
  referenceId: string | null
  referenceNumber: string | null
  notes: string | null
  createdAt: string | null
  materialCode: string | null
  companyName: string | null
  warehouseName: string | null
  itemMasterId: string | null
  itemCode: string | null
  itemName: string | null
}

const fmtQ = (n: number) => formatNumber(n, 3)

function itemLabel(r: LedgerDeletionRow) {
  if (r.itemCode) return `${r.itemCode} — ${r.itemName ?? ''}`.trim()
  return [r.materialCode, r.sizeLabel].filter(Boolean).join(' ') || '—'
}

// One group per Delete click: delete_stock_ledger_rows() stamps every row of
// a call with the same deleted_at.
export function LedgerDeletionsRows({ records }: { records: LedgerDeletionRow[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return records
    return records.filter((r) =>
      [r.itemCode, r.itemName, r.materialCode, r.sizeLabel, r.referenceNumber, r.purchaseLineId,
        r.notes, r.deletedBy, getEntryTypeLabel(r.entryType), r.entryType]
        .some((v) => v?.toLowerCase().includes(q))
    )
  }, [records, query])

  const groups = useMemo(() => {
    const byAction = new Map<string, LedgerDeletionRow[]>()
    for (const r of filtered) {
      const list = byAction.get(r.deletedAt)
      if (list) list.push(r)
      else byAction.set(r.deletedAt, [r])
    }
    return [...byAction.entries()].map(([deletedAt, rows]) => ({
      deletedAt,
      rows,
      deletedBy: rows[0].deletedBy,
      net: rows.reduce((s, r) => s + r.quantity, 0),
      references: [...new Set(rows.map((r) => r.referenceNumber).filter(Boolean))],
    }))
  }, [filtered])

  const exportRows = filtered.map((r) => ({
    'Deleted On': formatDateTime(r.deletedAt),
    'Deleted By': r.deletedBy ?? '',
    'Item': itemLabel(r),
    'Size': r.sizeLabel ?? '',
    'Type': getEntryTypeLabel(r.entryType),
    'Transaction Date': r.entryDate ? formatDate(r.entryDate) : '',
    'Reference': r.referenceNumber ?? '',
    'Purchase Line': r.purchaseLineId ?? '',
    'Company': r.companyName ?? '',
    'Warehouse': r.warehouseName ?? '',
    'Quantity': r.quantity,
    'Notes': r.notes ?? '',
    'Originally Created': r.createdAt ? formatDateTime(r.createdAt) : '',
    'Ledger Row ID': r.stockLedgerId,
  }))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search item, reference, purchase line, type…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {filtered.length > 0 && <ExportExcelButton rows={exportRows} filename="deleted-ledger-rows" sheetName="Deleted Ledger Rows" />}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {filtered.length === 0 ? (
            <p className="p-12 text-center text-sm text-gray-500">No deleted rows match “{query}”.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Txn Date</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Purchase Line</th>
                  <th className="px-4 py-3 font-medium">Company / Warehouse</th>
                  <th className="px-4 py-3 font-medium text-right">In</th>
                  <th className="px-4 py-3 font-medium text-right">Out</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Originally Created</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.deletedAt}>
                    <tr className="border-y bg-red-50/60">
                      <td colSpan={10} className="px-4 py-2 text-xs text-gray-700">
                        <span className="font-semibold text-gray-900">Deleted {formatDateTime(g.deletedAt)}</span>
                        {' · '}by {g.deletedBy ?? <span className="italic text-gray-500">unknown user</span>}
                        {' · '}{g.rows.length} row{g.rows.length !== 1 ? 's' : ''}
                        {' · '}net{' '}
                        <span className={Math.abs(g.net) > 0.0005 ? 'font-semibold text-red-700' : 'text-gray-700'}>
                          {fmtQ(g.net)}
                        </span>
                        {Math.abs(g.net) <= 0.0005 && <span className="text-gray-500"> (stock unchanged)</span>}
                        {g.references.length > 0 && <span className="text-gray-500"> · {g.references.join(', ')}</span>}
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-800">
                          <ItemLedgerLink itemMasterId={r.itemMasterId} fromDate={r.entryDate}>{itemLabel(r)}</ItemLedgerLink>
                          {r.itemCode && r.sizeLabel && <div className="text-xs text-gray-500">{r.sizeLabel}</div>}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-700">{getEntryTypeLabel(r.entryType)}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-gray-600">{r.entryDate ? formatDate(r.entryDate) : '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                          {r.referenceType === 'job_work'
                            ? <JobWorkLink orderId={r.referenceId}>{r.referenceNumber ?? '—'}</JobWorkLink>
                            : <span className="text-gray-700">{r.referenceNumber ?? '—'}</span>}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap"><PurchaseLineLink lineId={r.purchaseLineId} /></td>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {r.companyName ?? '—'}
                          {r.warehouseName && <div className="text-gray-400">{r.warehouseName}</div>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-green-700">{r.quantity > 0 ? fmtQ(r.quantity) : ''}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-red-700">{r.quantity < 0 ? fmtQ(-r.quantity) : ''}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{r.notes ?? ''}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{r.createdAt ? formatDateTime(r.createdAt) : '—'}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
