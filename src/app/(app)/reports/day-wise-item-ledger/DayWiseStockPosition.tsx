'use client'

import { useState } from 'react'
import { Info, Package } from 'lucide-react'
import type { StockPosition } from '@/lib/dayWiseItemLedgerData'

const qty = (n: number) => n.toFixed(3)

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'in' | 'out' | 'strong'
}) {
  const toneClass =
    tone === 'in'
      ? 'text-green-700'
      : tone === 'out'
        ? 'text-red-700'
        : tone === 'strong'
          ? 'text-gray-900'
          : 'text-gray-700'
  return (
    <div className="min-w-[9rem] flex-1 rounded-lg border bg-white px-4 py-3">
      <p className="text-[0.6875rem] font-medium uppercase text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

/**
 * Opening and closing stock for the selected period.
 *
 * Balances are computed over EVERY entry type in scope, not just the
 * transactions listed below — a balance filtered to one transaction type
 * would not be a balance. closing always equals
 * opening + inward - outward, so the strip can be checked by eye.
 */
export function DayWiseStockPosition({
  positions,
  totals,
  fromDate,
  toDate,
  scopeBroaderThanList,
}: {
  positions: StockPosition[]
  totals: { opening: number; periodInward: number; periodOutward: number; closing: number }
  fromDate: string
  toDate: string
  scopeBroaderThanList: boolean
}) {
  const [open, setOpen] = useState(false)
  if (positions.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <StatCard label={`Opening Stock (${fromDate})`} value={qty(totals.opening)} />
        <StatCard label="Inward this period" value={qty(totals.periodInward)} tone="in" />
        <StatCard label="Outward this period" value={qty(totals.periodOutward)} tone="out" />
        <StatCard label={`Closing Stock (${toDate})`} value={qty(totals.closing)} tone="strong" />
      </div>

      {scopeBroaderThanList && (
        <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 print:hidden">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Opening and closing stock count every transaction type in the selected company,
            warehouse and item scope — a balance limited to one transaction type or party would
            not be a true balance. The transaction list below is narrowed by your other filters.
          </span>
        </p>
      )}

      <div className="rounded-xl border bg-white print:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Package className="h-4 w-4 text-gray-500" />
            Opening &amp; Closing Stock by Item ({positions.length})
          </span>
          <span className="text-sm text-blue-600">{open ? 'Hide' : 'Show'}</span>
        </button>

        {open && (
          <div className="max-h-96 overflow-auto border-t">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b text-left text-xs uppercase text-gray-500">
                  <th className="px-3 py-2 font-medium">Item Code</th>
                  <th className="px-3 py-2 font-medium">Item Description</th>
                  <th className="px-3 py-2 font-medium">Item Size</th>
                  <th className="px-3 py-2 text-center font-medium">UOM</th>
                  <th className="px-3 py-2 text-right font-medium">Opening</th>
                  <th className="px-3 py-2 text-right font-medium">Inward</th>
                  <th className="px-3 py-2 text-right font-medium">Outward</th>
                  <th className="px-3 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={`${p.materialTypeId}|${p.materialSizeId ?? ''}`}
                    className="border-b border-gray-100 last:border-0"
                  >
                    <td className="px-3 py-2 font-medium text-gray-800">{p.itemCode}</td>
                    <td className="px-3 py-2 text-gray-700">{p.itemDescription}</td>
                    <td className="px-3 py-2 text-gray-700">{p.itemSize}</td>
                    <td className="px-3 py-2 text-center text-gray-500">{p.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(p.opening)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{qty(p.periodInward)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{qty(p.periodOutward)}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        p.closing < 0 ? 'text-red-700' : 'text-gray-900'
                      }`}
                    >
                      {qty(p.closing)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 font-semibold text-gray-700">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{qty(totals.opening)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-green-700">{qty(totals.periodInward)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-red-700">{qty(totals.periodOutward)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{qty(totals.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
