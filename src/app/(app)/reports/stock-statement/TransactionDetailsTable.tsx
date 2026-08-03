'use client'

import { useMemo, useState } from 'react'
import type { TransactionDetailRow } from '@/lib/exportStockStatementExcel'

const fmtQ = (n: number) => n.toFixed(3)
const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))

const MOVEMENT_STYLE: Record<string, string> = {
  INWARD: 'bg-green-100 text-green-800',
  OUTWARD: 'bg-red-100 text-red-800',
  TRANSFER: 'bg-blue-100 text-blue-800',
  ADJUSTMENT: 'bg-gray-100 text-gray-800',
}

export default function TransactionDetailsTable({
  transactions,
  reconciled,
  focusItemKey,
  focusItemLabel,
  onClearFocus,
}: {
  transactions: TransactionDetailRow[]
  reconciled: boolean
  focusItemKey: string | null
  focusItemLabel: string | null
  onClearFocus: () => void
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [movementFilter, setMovementFilter] = useState('')

  const types = useMemo(
    () => Array.from(new Set(transactions.filter((t) => !t.isOpeningRow).map((t) => t.typeLabel))).sort(),
    [transactions]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter((t) => {
      if (focusItemKey && t.itemKey !== focusItemKey) return false
      if (typeFilter && t.typeLabel !== typeFilter) return false
      if (movementFilter && t.stockMovement !== movementFilter) return false
      if (q) {
        const haystack = [t.documentNumber, t.itemCode, t.itemName, t.vendorName, t.customerName, t.remarks]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [transactions, focusItemKey, typeFilter, movementFilter, search])

  const totals = useMemo(() => {
    const nonOpening = filtered.filter((t) => !t.isOpeningRow)
    return {
      inward: nonOpening.reduce((s, t) => s + t.inwardQty, 0),
      outward: nonOpening.reduce((s, t) => s + t.outwardQty, 0),
      warehouseChange: nonOpening.reduce((s, t) => s + t.warehouseChange, 0),
      vendorChange: nonOpening.reduce((s, t) => s + t.vendorChange, 0),
      value: nonOpening.reduce((s, t) => s + (t.value ?? 0), 0),
    }
  }, [filtered])

  return (
    <div>
      <div className="px-4 py-2 border-b bg-gray-50 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search document, item, vendor, customer…"
          className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[16rem] focus:border-blue-500 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={movementFilter}
          onChange={(e) => setMovementFilter(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Movements</option>
          <option value="INWARD">Inward</option>
          <option value="OUTWARD">Outward</option>
          <option value="TRANSFER">Transfer</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
        {focusItemKey && (
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 text-blue-800 text-xs px-3 py-1.5">
            Showing: {focusItemLabel}
            <button type="button" onClick={onClearFocus} className="font-bold hover:text-blue-900">✕</button>
          </span>
        )}
        <span className="ml-auto text-xs text-gray-500">
          {filtered.length} of {transactions.length} rows
          {!reconciled && <span className="ml-2 font-semibold text-red-600">⚠ Reconciliation mismatch detected</span>}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="p-8 text-center text-gray-500 text-sm">
          {transactions.length === 0
            ? 'No stock movements found for the selected period.'
            : 'No transactions match the current search/filter.'}
        </p>
      ) : (
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="sticky top-0 z-10">
            <tr className="border-b text-[11px] font-semibold uppercase">
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Date</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Type</th>
              <th className="px-2 py-2 text-center text-gray-600 bg-white">Movement</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Document</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Warehouse</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Vendor / Customer</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Item</th>
              <th className="px-2 py-2 text-right text-green-700 bg-green-50">Inward</th>
              <th className="px-2 py-2 text-right text-red-700 bg-red-50">Outward</th>
              <th className="px-2 py-2 text-right text-blue-700 bg-blue-50">Wh Change</th>
              <th className="px-2 py-2 text-right text-amber-700 bg-amber-50">Vendor Change</th>
              <th className="px-2 py-2 text-right text-gray-800 bg-gray-100">Wh Balance</th>
              <th className="px-2 py-2 text-right text-amber-800 bg-amber-50">Vendor Balance</th>
              <th className="px-2 py-2 text-right text-teal-700 bg-teal-50">Rate</th>
              <th className="px-2 py-2 text-right text-teal-700 bg-teal-50">Value</th>
              <th className="px-2 py-2 text-left text-gray-600 bg-white">Created By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((t, idx) => (
              <tr key={idx} className={t.isOpeningRow ? 'bg-blue-50/50 italic' : 'hover:bg-gray-50'}>
                <td className="px-2 py-2">{fmtDate(t.date)}</td>
                <td className="px-2 py-2 font-medium text-gray-900">{t.typeLabel}</td>
                <td className="px-2 py-2 text-center">
                  {t.stockMovement && (
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${MOVEMENT_STYLE[t.stockMovement] ?? 'bg-gray-100 text-gray-700'}`}>
                      {t.stockMovement}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-gray-500">{t.documentNumber || '—'}</td>
                <td className="px-2 py-2 text-gray-600">
                  {t.warehouseName || '—'}
                  {(t.sourceWarehouseName || t.destinationWarehouseName) && (
                    <span className="block text-[10px] text-gray-400">
                      {t.sourceWarehouseName} → {t.destinationWarehouseName}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-gray-600">{t.vendorName || t.customerName || '—'}</td>
                <td className="px-2 py-2 font-medium text-gray-900">
                  {t.itemName}{t.size ? ` (${t.size})` : ''}
                </td>
                <td className="px-2 py-2 text-right text-green-700 bg-green-50/40">{t.inwardQty ? fmtQ(t.inwardQty) : '—'}</td>
                <td className="px-2 py-2 text-right text-red-700 bg-red-50/40">{t.outwardQty ? fmtQ(t.outwardQty) : '—'}</td>
                <td className={`px-2 py-2 text-right bg-blue-50/40 ${t.warehouseChange < 0 ? 'text-red-600 font-semibold' : 'text-blue-700'}`}>
                  {t.isOpeningRow ? '—' : `${t.warehouseChange >= 0 ? '+' : ''}${fmtQ(t.warehouseChange)}`}
                </td>
                <td className={`px-2 py-2 text-right bg-amber-50/40 ${t.vendorChange < 0 ? 'text-red-600 font-semibold' : 'text-amber-700'}`}>
                  {t.isOpeningRow ? '—' : `${t.vendorChange >= 0 ? '+' : ''}${fmtQ(t.vendorChange)}`}
                </td>
                <td className={`px-2 py-2 text-right font-semibold bg-gray-100/60 ${t.warehouseBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {fmtQ(t.warehouseBalance)}
                </td>
                <td className={`px-2 py-2 text-right font-semibold bg-amber-50/60 ${t.vendorBalance < 0 ? 'text-red-600' : 'text-amber-800'}`}>
                  {fmtQ(t.vendorBalance)}
                </td>
                <td className="px-2 py-2 text-right text-teal-700 bg-teal-50/40">{t.rate != null ? fmtC(t.rate) : '—'}</td>
                <td className="px-2 py-2 text-right text-teal-700 bg-teal-50/40">{t.value != null ? fmtC(t.value) : '—'}</td>
                <td className="px-2 py-2 text-gray-500">{t.createdBy || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-2 py-2 text-gray-700" colSpan={7}>Total (excludes Opening Balance rows)</td>
              <td className="px-2 py-2 text-right text-green-800">{fmtQ(totals.inward)}</td>
              <td className="px-2 py-2 text-right text-red-800">{fmtQ(totals.outward)}</td>
              <td className="px-2 py-2 text-right text-blue-800">{fmtQ(totals.warehouseChange)}</td>
              <td className="px-2 py-2 text-right text-amber-800">{fmtQ(totals.vendorChange)}</td>
              <td className="px-2 py-2 text-right text-gray-400">—</td>
              <td className="px-2 py-2 text-right text-gray-400">—</td>
              <td className="px-2 py-2 text-right text-gray-400">—</td>
              <td className="px-2 py-2 text-right text-teal-800">{fmtC(totals.value)}</td>
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
