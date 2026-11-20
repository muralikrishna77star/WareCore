'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { exportRowsToExcel } from '@/lib/exportExcel'
import { TRACKING_REPORTS, type ReportCell, type ReportColumn, type TrackingReportKey, type TrackingReportResult } from '@/lib/tracking/reportDefs'
import { errorText, formatWhen, trackingApi } from './api'
import { WarehouseFilter } from './WarehouseFilter'

const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)

function display(column: ReportColumn, value: ReportCell): string {
  if (value == null || value === '') return ''
  switch (column.kind) {
    case 'datetime': return formatWhen(String(value))
    case 'percent': return `${value}%`
    case 'quantity': return Number(value).toFixed(3)
    default: return String(value)
  }
}

/** The value written to Excel: numbers stay numbers so they can be added up there. */
function excelValue(column: ReportColumn, value: ReportCell): string | number | null {
  if (value == null || value === '') return null
  if (column.kind === 'number' || column.kind === 'quantity' || column.kind === 'percent') return Number(value)
  if (column.kind === 'datetime') return formatWhen(String(value))
  return value
}

export function TrackingReport({ reportKey, initialWarehouse }: { reportKey: TrackingReportKey; initialWarehouse: string }) {
  const def = TRACKING_REPORTS.find((r) => r.key === reportKey)!
  const [warehouseId, setWarehouseId] = useState(initialWarehouse)
  const [from, setFrom] = useState(istDate(-29))
  const [to, setTo] = useState(istDate())
  const [place, setPlace] = useState('all')
  const [result, setResult] = useState<TrackingReportResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    const params = new URLSearchParams()
    if (warehouseId) params.set('warehouse_id', warehouseId)
    if (def.dates) { params.set('from', from); params.set('to', to) }
    if (reportKey === 'ageing') params.set('place', place)
    const timer = setTimeout(() => {
      setLoading(true)
      trackingApi<TrackingReportResult>(`reports/${reportKey}?${params}`)
        .then((data) => { if (current) { setResult(data); setError('') } })
        .catch((err) => { if (current) setError(errorText(err)) })
        .finally(() => { if (current) setLoading(false) })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [reportKey, def.dates, warehouseId, from, to, place])

  const download = async () => {
    if (!result) return
    const rows = result.rows.map((row) => Object.fromEntries(result.columns.map((c) => [c.label, excelValue(c, row[c.key])])))
    await exportRowsToExcel(rows, `${result.title} ${istDate()}`, result.title.slice(0, 31))
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports/tracking" className="text-sm text-blue-600 hover:underline">QR Tracking reports</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">{def.title}</h1>
        <p className="text-sm text-gray-500">{def.description}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <WarehouseFilter value={warehouseId} onChange={setWarehouseId} />
        {def.dates && (
          <>
            <label className="text-sm text-gray-700">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded-lg border border-gray-300 px-2 py-1.5" /></label>
            <label className="text-sm text-gray-700">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded-lg border border-gray-300 px-2 py-1.5" /></label>
          </>
        )}
        {reportKey === 'ageing' && (
          <select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Where" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="all">Yard and vendors</option>
            <option value="yard">In the yard</option>
            <option value="vendor">At vendors</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => void download()}
          disabled={!result || result.rows.length === 0}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Download Excel
        </button>
      </div>

      {result?.note && <p className="text-sm text-gray-600">{result.note}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && !result && <p className="text-sm text-gray-500">Loading…</p>}
      {result && result.truncated && <p className="text-sm text-amber-700">Showing the first {result.rows.length} rows. Narrow the warehouse or dates to see the rest.</p>}
      {result && result.rows.length === 0 && !error && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">Nothing to show for these filters yet.</p>
      )}
      {result && result.rows.length > 0 && (
        <div className={`overflow-auto rounded-lg border border-gray-200 bg-white ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                {result.columns.map((c) => (
                  <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${['number', 'quantity', 'percent'].includes(c.kind ?? '') ? 'text-right' : ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => {
                    const text = display(c, row[c.key])
                    const numeric = ['number', 'quantity', 'percent'].includes(c.kind ?? '')
                    const href = c.hrefKey ? row[c.hrefKey] : null
                    return (
                      <td key={c.key} className={`px-3 py-2 ${numeric ? 'text-right tabular-nums' : ''} ${c.kind === 'code' ? 'font-mono' : ''} ${c.kind === 'datetime' ? 'whitespace-nowrap' : ''}`}>
                        {href ? <Link href={String(href)} className="text-blue-600 hover:underline">{text}</Link> : text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
