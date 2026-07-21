'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import DeleteJobWorkTransferButton from './DeleteJobWorkTransferButton'

type FlatRow = {
  key: string
  transferId: string
  transferNo: string
  date: string
  fromVendor: string
  fromOrderRef: string
  fromOrderId: string | null
  toVendor: string
  toOrderRef: string
  toOrderId: string | null
  purchaseLine: string
  item: string
  size: string
  qtyLabel: string
  qty: number
  unit: string
  reason: string
}

const COLUMNS = [
  { key: 'transferNo', label: 'Transfer No.' },
  { key: 'date', label: 'Date' },
  { key: 'from', label: 'From' },
  { key: 'to', label: 'To' },
  { key: 'purchaseLine', label: 'Purchase Line' },
  { key: 'item', label: 'Item' },
  { key: 'size', label: 'Size' },
  { key: 'reason', label: 'Reason' },
] as const

export default function JobWorkTransfersTable({ records, canDelete }: { records: any[]; canDelete: boolean }) {
  const [filters, setFilters] = useState<Record<string, string>>({})

  const flatRows: FlatRow[] = useMemo(() => {
    return records.flatMap((t: any) => {
      const items = t.job_work_transfer_items ?? []
      const base = {
        transferId: t.id,
        transferNo: t.transfer_number || '',
        date: formatDate(t.transfer_date),
        fromVendor: t.from_vendor?.name || '',
        fromOrderRef: t.from_job_work_order?.reference_number || '',
        fromOrderId: t.from_job_work_order?.id || null,
        toVendor: t.to_vendor?.name || '',
        toOrderRef: t.to_job_work_order?.reference_number || '',
        toOrderId: t.to_job_work_order?.id || null,
        reason: t.reason || '',
      }
      const rows = items.length > 0 ? items : [null]
      return rows.map((it: any, idx: number) => ({
        key: it?.id ?? `${t.id}-${idx}`,
        ...base,
        purchaseLine: it?.purchase_line_id || '',
        item: it?.item_name || '',
        size: it?.size_label || '',
        qty: it ? Number(it.quantity_transferred) : 0,
        qtyLabel: it ? `${Number(it.quantity_transferred).toFixed(3)} ${it.unit || ''}`.trim() : '',
        unit: it?.unit || '',
      }))
    })
  }, [records])

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '')
    if (active.length === 0) return flatRows
    return flatRows.filter((row) =>
      active.every(([key, value]) => {
        const needle = value.trim().toLowerCase()
        if (key === 'from') return `${row.fromVendor} ${row.fromOrderRef}`.toLowerCase().includes(needle)
        if (key === 'to') return `${row.toVendor} ${row.toOrderRef}`.toLowerCase().includes(needle)
        const hay = (row as any)[key]
        return typeof hay === 'string' && hay.toLowerCase().includes(needle)
      })
    )
  }, [flatRows, filters])

  // Group contiguous rows sharing the same transfer for rowSpan-merged cells.
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const row of filtered) counts[row.transferId] = (counts[row.transferId] ?? 0) + 1
    return counts
  }, [filtered])
  const seenTransfer = new Set<string>()

  const exportRows = filtered.map((row) => ({
    'Transfer No.': row.transferNo,
    'Transfer Date': row.date,
    'From Vendor': row.fromVendor,
    'To Vendor': row.toVendor,
    'From Order': row.fromOrderRef,
    'To Order': row.toOrderRef,
    'Purchase Line ID': row.purchaseLine,
    'Item': row.item,
    'Qty Transferred': row.qty || '',
    'Unit': row.unit,
    'Reason': row.reason,
  }))

  return (
    <>
      {filtered.length > 0 && (
        <div className="flex justify-end px-2 py-2 bg-white border-b">
          <ExportExcelButton rows={exportRows} filename="jobwork-transfers" sheetName="Job Work Transfers" />
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr className="text-left border-b">
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">{col.label}</th>
            ))}
            <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
            {canDelete && <th className="px-2 py-2 text-xs font-medium text-gray-500 uppercase">Actions</th>}
          </tr>
          <tr className="border-b bg-white">
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-2 py-2 align-top">
                <input
                  type="text"
                  value={filters[col.key] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                  placeholder="Search..."
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs font-normal normal-case text-gray-700 focus:border-blue-400 focus:outline-none"
                />
              </th>
            ))}
            <th className="px-2 py-2" />
            {canDelete && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1 + (canDelete ? 1 : 0)} className="px-4 py-8 text-center text-gray-400">
                No transfers match your search.
              </td>
            </tr>
          )}
          {filtered.map((row) => {
            const isFirst = !seenTransfer.has(row.transferId)
            seenTransfer.add(row.transferId)
            const rowCount = groupCounts[row.transferId] ?? 1
            return (
              <tr key={row.key} className={`hover:bg-gray-50 align-top ${!isFirst ? 'border-t border-gray-50' : ''}`}>
                {isFirst && (
                  <>
                    <td className="px-2 py-2 font-mono text-xs text-purple-700 whitespace-nowrap" rowSpan={rowCount}>{row.transferNo}</td>
                    <td className="px-2 py-2 text-gray-600 whitespace-nowrap" rowSpan={rowCount}>{row.date}</td>
                    <td className="px-2 py-2 whitespace-nowrap" rowSpan={rowCount}>
                      <span className="text-gray-700">{row.fromVendor || '—'}</span>
                      {row.fromOrderId && (
                        <Link href={`/jobwork/${row.fromOrderId}`} className="block text-[10px] font-mono text-blue-600 hover:underline">
                          {row.fromOrderRef}
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap" rowSpan={rowCount}>
                      <span className="text-gray-700">{row.toVendor || '—'}</span>
                      {row.toOrderId && (
                        <Link href={`/jobwork/${row.toOrderId}`} className="block text-[10px] font-mono text-blue-600 hover:underline">
                          {row.toOrderRef}
                        </Link>
                      )}
                    </td>
                  </>
                )}
                <td className="px-2 py-2 font-mono text-xs text-blue-700 whitespace-nowrap">{row.purchaseLine || '—'}</td>
                <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{row.item || '—'}</td>
                <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{row.size || '—'}</td>
                {isFirst && (
                  <td className="px-2 py-2 text-gray-600" rowSpan={rowCount}>{row.reason || '—'}</td>
                )}
                <td className="px-2 py-2 text-right text-gray-700 whitespace-nowrap">{row.qtyLabel || '—'}</td>
                {isFirst && canDelete && (
                  <td className="px-2 py-2" rowSpan={rowCount}>
                    <DeleteJobWorkTransferButton transferId={row.transferId} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
