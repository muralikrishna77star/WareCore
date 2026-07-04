'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { ReferenceLink } from '@/components/ReferenceLink'
import { isReferenceType } from '@/lib/reference'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  PURCHASE_IN: { label: 'Purchase In', color: 'bg-green-100 text-green-800' },
  VENDOR_RETURN_IN: { label: 'Vendor Return In', color: 'bg-green-100 text-green-800' },
  SALE_OUT: { label: 'Sale / Dispatch', color: 'bg-red-100 text-red-800' },
  SALE_CANCEL: { label: 'Sale Cancelled', color: 'bg-gray-100 text-gray-700' },
  PURCHASE_CANCEL: { label: 'Purchase Cancelled', color: 'bg-gray-100 text-gray-700' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  TRANSFER_IN: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  JOB_WORK_OUT: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_CANCEL: { label: 'Job Work Cancelled', color: 'bg-gray-100 text-gray-700' },
  ADJUSTMENT_IN: { label: 'Adjustment In', color: 'bg-gray-100 text-gray-800' },
  ADJUSTMENT_OUT: { label: 'Adjustment Out', color: 'bg-gray-100 text-gray-800' },
}

export type LedgerRow = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  purchase_line_id?: string | null
  sub_purchase_line_id?: string | null
  notes?: string | null
  companies?: { name: string } | null
  warehouses?: { name: string } | null
  balance: number
  orphaned: boolean
  duplicateCount: number
}

const fmtQ = (n: number) => n.toFixed(3)

export function ItemLedgerRows({ rows, canManage }: { rows: LedgerRow[]; canManage: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRows = rows.filter((r) => selected.has(r.id))
  const netEffect = selectedRows.reduce((s, r) => s + Number(r.quantity), 0)

  const handleDelete = async () => {
    if (!selectedRows.length) return
    const netWarning = Math.abs(netEffect) > 0.001
      ? `\n\nWarning: the selected rows do NOT net to zero (net ${fmtQ(netEffect)}) — deleting them will change this item's current stock balance.`
      : ''
    const ok = window.confirm(
      `Permanently delete ${selectedRows.length} ledger row${selectedRows.length !== 1 ? 's' : ''}? This cannot be undone.${netWarning}`
    )
    if (!ok) return

    setDeleting(true)
    setError('')
    try {
      const res = await fetch('/api/stock/ledger-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Server error (${res.status})`)
        return
      }
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {canManage && selected.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-amber-50 px-4 py-2">
          <p className="text-sm text-amber-900">
            {selected.size} row{selected.size !== 1 ? 's' : ''} selected · net {fmtQ(netEffect)}
            {Math.abs(netEffect) > 0.001 && (
              <span className="ml-2 font-medium text-red-700">(does not net to zero)</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-gray-600 hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Selected'}
            </button>
          </div>
        </div>
      )}
      <tbody className="divide-y divide-gray-100">
        {rows.map((row) => {
          const cfg = entryTypeConfig[row.entry_type] ?? { label: row.entry_type, color: 'bg-gray-100 text-gray-800' }
          const qty = Number(row.quantity)
          const lineId = row.sub_purchase_line_id || row.purchase_line_id
          return (
            <tr key={row.id} className={`hover:bg-gray-50 ${selected.has(row.id) ? 'bg-red-50/50' : ''}`}>
              {canManage && (
                <td className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    className="rounded border-gray-300"
                  />
                </td>
              )}
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.color}`}>
                  {cfg.label}
                </span>
                {row.orphaned && (
                  <span
                    title="This entry's reference (bill/dispatch/job work/transfer) no longer exists"
                    className="ml-1 inline-flex rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                  >
                    orphaned
                  </span>
                )}
                {!row.orphaned && row.duplicateCount > 1 && (
                  <span
                    title="More than one ledger row shares this reference + line — review for duplicates"
                    className="ml-1 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                  >
                    {row.duplicateCount}×
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                {isReferenceType(row.reference_type) && row.reference_id ? (
                  <ReferenceLink type={row.reference_type} id={row.reference_id} className="text-blue-600 hover:underline">
                    {row.reference_number || '—'}
                  </ReferenceLink>
                ) : (
                  row.reference_number || '—'
                )}
                {lineId && (
                  <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {lineId}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-700">{row.companies?.name || '—'}</td>
              <td className="px-4 py-3 text-gray-500">{row.warehouses?.name || '—'}</td>
              <td className="px-4 py-3 text-right text-green-700 font-medium">{qty > 0 ? fmtQ(qty) : ''}</td>
              <td className="px-4 py-3 text-right text-red-600 font-medium">{qty < 0 ? fmtQ(Math.abs(qty)) : ''}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(row.balance)}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs">{row.notes || '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </>
  )
}
