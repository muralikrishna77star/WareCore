'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'
import type { ActivityEvent, ActivityKind, ActivityLineSummary } from '@/lib/jobWorkActivity'

const KIND_BADGE: Record<ActivityKind, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  sent_corrected: { label: 'Correction', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  correction: { label: 'Correction', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  transfer_in: { label: 'Transfer In', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  transfer_out: { label: 'Transfer Out', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  returned: { label: 'Return', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  output_return: { label: 'Return', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  output_received: { label: 'Output', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  output_corrected: { label: 'Output Correction', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  direct_sale: { label: 'Direct Sale', className: 'bg-amber-50 text-amber-700 border-amber-200' },
}

const fmt = (n: number) => (Math.abs(n) < 0.0005 ? 0 : n).toFixed(3)

export default function JobWorkActivitySection({
  events,
  lines,
  itemLabels,
}: {
  events: ActivityEvent[]
  lines: Record<string, ActivityLineSummary>
  itemLabels: Record<string, { item: string; purchaseLine: string | null }>
}) {
  const totals = Object.values(lines).reduce(
    (acc, l) => ({
      sent: acc.sent + l.sent,
      returned: acc.returned + l.returned,
      soldDirect: acc.soldDirect + l.soldDirect,
      transferredOut: acc.transferredOut + l.transferredOut,
      atVendor: acc.atVendor + l.atVendor,
    }),
    { sent: 0, returned: 0, soldDirect: 0, transferredOut: 0, atVendor: 0 }
  )
  const missingCount = Object.values(lines).filter((l) => l.missingLedger).length

  // Events arrive oldest first; useTableSort is stable, so an ascending Item
  // sort lists each item's history oldest first (descending reverses the
  // whole list, newest first). A third click restores the original order.
  const itemLabelFor = (e: ActivityEvent) => {
    const label = e.itemId ? itemLabels[e.itemId] : null
    return label ? `${label.item} ${label.purchaseLine ?? ''}` : e.materialLabel ?? null
  }
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(events, {
    date: (e) => e.date,
    item: itemLabelFor,
  })

  const cards = [
    { label: 'Sent to Vendor', value: totals.sent, className: 'text-blue-700' },
    { label: 'Returned to Warehouse', value: totals.returned, className: 'text-emerald-700' },
    { label: 'Sold Direct from Vendor', value: totals.soldDirect, className: 'text-amber-700' },
    { label: 'Transferred to Other Vendors', value: totals.transferredOut, className: 'text-purple-700' },
    { label: 'Still at Vendor', value: totals.atVendor, className: totals.atVendor < -0.0005 ? 'text-red-600' : 'text-gray-900' },
  ]

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-4">
      <div className="px-3 py-2 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Activity</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Everything that has happened to this order&apos;s material, oldest first. A direct sale is shown here as one event;
          Purchase Line Movements and the Item Ledger show it as two rows — a &ldquo;Job Work Return In — Vendor direct sale —
          virtual return&rdquo; and a &ldquo;Sale Out&rdquo;.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-gray-100 border-b border-gray-100">
        {cards.map((c) => (
          <div key={c.label} className="bg-white px-3 py-2">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-base font-semibold font-mono ${c.className}`}>{fmt(c.value)}</p>
          </div>
        ))}
      </div>

      {missingCount > 0 && (
        <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {missingCount === 1 ? '1 line has' : `${missingCount} lines have`} no stock ledger entries, so stock reports don&apos;t
          count {missingCount === 1 ? 'it' : 'them'} and the totals above leave {missingCount === 1 ? 'it' : 'them'} out. Please report this for a data check.
        </div>
      )}

      {events.length === 0 ? (
        <p className="px-6 py-6 text-xs text-gray-400">No stock movements recorded for this order.</p>
      ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-3 !py-2" />
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">What Happened</th>
                <SortableTh label="Item" sortKey="item" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-3 !py-2" />
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Line Still at Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.map((e) => {
                const badge = KIND_BADGE[e.kind]
                const label = e.itemId ? itemLabels[e.itemId] : null
                return (
                  <tr key={e.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex px-2 py-0.5 rounded border text-xs font-medium ${badge.className}`}>{badge.label}</span>
                        <span className="font-medium text-gray-900">{e.title}</span>
                        {e.link && (
                          <Link href={e.link.href} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                            {e.link.label}
                          </Link>
                        )}
                      </div>
                      {e.detail && <p className="text-xs text-gray-500 mt-1">{e.detail}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {label ? (
                        <>
                          {label.item}
                          {label.purchaseLine && <div className="text-xs font-mono text-blue-700">{label.purchaseLine}</div>}
                        </>
                      ) : (
                        e.materialLabel ?? <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-mono whitespace-nowrap">
                      {e.kind === 'output_received' || e.kind === 'output_corrected' ? (
                        <span className="text-indigo-700">{fmt(e.quantity)}</span>
                      ) : (
                        <span className={e.vendorEffect >= 0 ? 'text-blue-700' : 'text-gray-900'}>
                          {e.vendorEffect >= 0 ? '+' : '−'}{fmt(Math.abs(e.vendorEffect))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right font-mono text-gray-900">
                      {e.lineBalanceAfter != null ? fmt(e.lineBalanceAfter) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
            Quantity: + adds to the stock held at the vendor, − takes it away.
          </p>
        </div>
      )}
    </div>
  )
}
