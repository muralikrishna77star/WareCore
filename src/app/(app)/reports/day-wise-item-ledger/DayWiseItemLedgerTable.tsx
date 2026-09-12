'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import type { DetailRow, LedgerReport, SummaryGroup, Totals } from '@/lib/dayWiseItemLedger'

const qty = (n: number | null | undefined) => (n == null ? '' : n.toFixed(3))
const money = (n: number | null | undefined) =>
  n == null ? '' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null | undefined) => (n == null ? '' : `${n.toFixed(2)}%`)

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(dt)
    .replace(/ /g, '-')
}

/** Inward green, outward red — the same colour language as the Excel export. */
function QtyCell({ inward, outward }: { inward: number; outward: number }) {
  return (
    <>
      <td className="px-3 py-2 text-right font-medium text-green-700">{inward ? qty(inward) : ''}</td>
      <td className="px-3 py-2 text-right font-medium text-red-700">{outward ? qty(outward) : ''}</td>
    </>
  )
}


function DetailTable({ rows }: { rows: DetailRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b bg-gray-50 text-left text-gray-500">
          <th className="px-3 py-1.5 font-medium">Time</th>
          <th className="px-3 py-1.5 font-medium">Type</th>
          <th className="px-3 py-1.5 font-medium">Document</th>
          <th className="px-3 py-1.5 font-medium">Company</th>
          <th className="px-3 py-1.5 font-medium">Warehouse</th>
          <th className="px-3 py-1.5 text-right font-medium">Inward</th>
          <th className="px-3 py-1.5 text-right font-medium">Outward</th>
          <th className="px-3 py-1.5 text-right font-medium">Rate</th>
          <th className="px-3 py-1.5 text-right font-medium">Basic</th>
          <th className="px-3 py-1.5 text-right font-medium">GST %</th>
          <th className="px-3 py-1.5 text-right font-medium">CGST</th>
          <th className="px-3 py-1.5 text-right font-medium">SGST</th>
          <th className="px-3 py-1.5 text-right font-medium">Total GST</th>
          <th className="px-3 py-1.5 text-right font-medium">Total</th>
          <th className="px-3 py-1.5 font-medium">Party</th>
          <th className="px-3 py-1.5 font-medium">Source → Destination</th>
          <th className="px-3 py-1.5 font-medium">Status</th>
          <th className="px-3 py-1.5 font-medium">Created By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const party = r.supplierName || r.customerName || r.jobWorkerName
          const route = [r.source, r.destination].filter(Boolean).join(' → ')
          return (
            <tr key={r.ledgerId} className="border-b border-gray-100 last:border-0 hover:bg-white">
              <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.entryTime}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.entryTypeLabel}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.href ? (
                  <Link href={r.href} className="text-blue-600 hover:underline">
                    {r.documentNumber || '—'}
                  </Link>
                ) : (
                  <span className="text-gray-700">{r.documentNumber || '—'}</span>
                )}
                {r.reconciliation && (
                  <span title={`${r.reconciliation.issue}: ${r.reconciliation.detail}`}>
                    <TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" />
                  </span>
                )}
              </td>
              <td className="px-3 py-2">{r.companyName}</td>
              <td className="px-3 py-2">{r.warehouseName}</td>
              <QtyCell inward={r.inwardQuantity} outward={r.outwardQuantity} />
              <td className="px-3 py-2 text-right">{money(r.rate)}</td>
              <td className="px-3 py-2 text-right">{money(r.basicAmount)}</td>
              <td className="px-3 py-2 text-right">{pct(r.gstPercent)}</td>
              <td className="px-3 py-2 text-right">{money(r.cgstAmount)}</td>
              <td className="px-3 py-2 text-right">{money(r.sgstAmount)}</td>
              <td className="px-3 py-2 text-right">{money(r.totalGst)}</td>
              <td className="px-3 py-2 text-right font-medium">{money(r.totalAmount)}</td>
              <td className="px-3 py-2">{party}</td>
              <td className="px-3 py-2 text-gray-600">{route}</td>
              <td className="px-3 py-2">
                <span
                  className={
                    r.status === 'Cancelled'
                      ? 'rounded bg-red-50 px-1.5 py-0.5 text-red-700'
                      : r.status === 'Draft'
                        ? 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-600'
                        : 'text-gray-600'
                  }
                >
                  {r.status}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600">{r.createdByName}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function TotalsCells({ totals }: { totals: Totals }) {
  return (
    <>
      <td className="px-3 py-2 text-right font-semibold text-green-700">{qty(totals.inwardQuantity)}</td>
      <td className="px-3 py-2 text-right font-semibold text-red-700">{qty(totals.outwardQuantity)}</td>
      <td className="px-3 py-2 text-right font-semibold">{money(totals.basicAmount)}</td>
      <td className="px-3 py-2 text-right font-semibold">{money(totals.totalGst)}</td>
      <td className="px-3 py-2 text-right font-semibold">{money(totals.totalAmount)}</td>
    </>
  )
}

function SummaryRow({ group }: { group: SummaryGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1 text-gray-500">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-medium text-gray-800">{group.itemCode}</span>
          </span>
        </td>
        <td className="px-3 py-2 text-gray-700">{group.itemDescription}</td>
        <td className="px-3 py-2 text-gray-700">{group.itemSize}</td>
        <td className="px-3 py-2 text-center text-gray-500">{group.unit}</td>
        <td className="px-3 py-2 text-right text-gray-500">
          {group.totals.transactionCount}
          {group.hasReconciliationIssue && (
            <TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" />
          )}
        </td>
        <TotalsCells totals={group.totals} />
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={10} className="px-4 py-2">
            <div className="overflow-x-auto rounded border bg-white">
              <DetailTable rows={group.rows} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function DayWiseItemLedgerTable({ report }: { report: LedgerReport }) {
  const [allOpen, setAllOpen] = useState(false)

  if (report.days.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-12 text-center">
        <p className="text-gray-500">No transactions match the selected filters.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-gray-500">
          {report.detail.length.toLocaleString('en-IN')} transactions across {report.days.length} day
          {report.days.length === 1 ? '' : 's'}
          {report.exceptions.length > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              <TriangleAlert className="h-3.5 w-3.5" />
              {report.exceptions.length} reconciliation exception
              {report.exceptions.length === 1 ? '' : 's'}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setAllOpen((o) => !o)}
          className="text-sm text-blue-600 hover:underline"
        >
          {allOpen ? 'Collapse all days' : 'Expand all days'}
        </button>
      </div>

      {report.days.map((day) => (
        <details key={day.entryDate} open={allOpen || report.days.length <= 3} className="rounded-xl border bg-white">
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-gray-900">{formatDate(day.entryDate)}</span>
              <span className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-gray-500">
                  In <strong className="text-green-700">{qty(day.totals.inwardQuantity)}</strong>
                </span>
                <span className="text-gray-500">
                  Out <strong className="text-red-700">{qty(day.totals.outwardQuantity)}</strong>
                </span>
                <span className="text-gray-500">
                  Basic <strong className="text-gray-800">{money(day.totals.basicAmount)}</strong>
                </span>
                <span className="text-gray-500">
                  GST <strong className="text-gray-800">{money(day.totals.totalGst)}</strong>
                </span>
                <span className="text-gray-500">
                  Total <strong className="text-gray-900">{money(day.totals.totalAmount)}</strong>
                </span>
              </span>
            </div>
          </summary>

          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-3 py-2 font-medium">Item Code</th>
                  <th className="px-3 py-2 font-medium">Item Description</th>
                  <th className="px-3 py-2 font-medium">Item Size</th>
                  <th className="px-3 py-2 text-center font-medium">UOM</th>
                  <th className="px-3 py-2 text-right font-medium">Txns</th>
                  <th className="px-3 py-2 text-right font-medium">Inward Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Outward Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Basic Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Total GST</th>
                  <th className="px-3 py-2 text-right font-medium">Total incl. GST</th>
                </tr>
              </thead>
              <tbody>
                {day.groups.map((g) => (
                  <SummaryRow key={g.key} group={g} />
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 font-semibold text-gray-700">
                    Total for {formatDate(day.entryDate)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-600">
                    {day.totals.transactionCount}
                  </td>
                  <TotalsCells totals={day.totals} />
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <div className="overflow-x-auto rounded-xl border-2 border-blue-200 bg-blue-50/40">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td colSpan={4} className="px-3 py-3 text-base font-bold text-gray-900">
                Report Total
              </td>
              <td className="px-3 py-3 text-right font-semibold text-gray-600">
                {report.grandTotals.transactionCount}
              </td>
              <TotalsCells totals={report.grandTotals} />
            </tr>
          </tbody>
        </table>
      </div>

      {report.exceptions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white print:hidden">
          <p className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
            <TriangleAlert className="h-4 w-4" /> Reconciliation Exceptions ({report.exceptions.length})
          </p>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b text-left text-gray-500">
                  <th className="px-3 py-1.5 font-medium">Date</th>
                  <th className="px-3 py-1.5 font-medium">Document</th>
                  <th className="px-3 py-1.5 font-medium">Item</th>
                  <th className="px-3 py-1.5 font-medium">Issue</th>
                  <th className="px-3 py-1.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {report.exceptions.map((e) => (
                  <tr key={`${e.ledgerId}-${e.issue}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(e.entryDate)}</td>
                    <td className="px-3 py-1.5">{e.documentNumber || '—'}</td>
                    <td className="px-3 py-1.5">
                      {e.itemCode} {e.itemSize && <span className="text-gray-500">{e.itemSize}</span>}
                    </td>
                    <td className="px-3 py-1.5 font-medium text-amber-800">{e.issue}</td>
                    <td className="px-3 py-1.5 text-gray-600">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

