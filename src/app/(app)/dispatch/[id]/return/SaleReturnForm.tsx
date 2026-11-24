'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { todayInIndia } from '@/lib/dates'
import DateInput from '@/components/DateInput'

export interface ReturnableLine {
  id: string
  itemCode: string | null
  itemName: string | null
  material: string | null
  saleLineId: string | null
  purchaseLineId: string | null
  size: string | null
  sold: number
  alreadyReturned: number
  remaining: number
  rate: number | null
}

const REASONS = ['Damaged', 'Wrong size', 'Wrong item', 'Quality issue', 'Excess supply', 'Rejected by customer']

const localToday = todayInIndia

const round3 = (n: number) => Math.round(n * 1000) / 1000

// crypto.randomUUID only exists on https/localhost; getRandomValues works
// everywhere (e.g. the app opened over a LAN IP).
function newUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export default function SaleReturnForm({ orderId, saleDate, lines }: { orderId: string; saleDate: string; lines: ReturnableLine[] }) {
  const router = useRouter()
  // One id per form: re-submitting after a timeout/double click sends the
  // same id, and the server hands back the return it already saved instead
  // of posting the stock again.
  const [returnId] = useState(newUuid)
  const [returnDate, setReturnDate] = useState(() => (localToday() < saleDate ? saleDate : localToday()))
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => lines.map((l) => {
    const raw = (qty[l.id] ?? '').trim()
    const value = raw === '' ? 0 : Number(raw)
    const invalid = raw !== '' && (!Number.isFinite(value) || value < 0)
    const over = Number.isFinite(value) && value > l.remaining + 0.0005
    return { line: l, value: Number.isFinite(value) ? value : 0, invalid, over }
  }), [lines, qty])

  const chosen = parsed.filter((p) => p.value > 0 && !p.invalid)
  const totalQty = round3(chosen.reduce((s, p) => s + p.value, 0))
  const totalAmount = chosen.reduce((s, p) => s + (p.line.rate ?? 0) * p.value, 0)
  const hasErrors = parsed.some((p) => p.invalid || p.over)
  const nothingLeft = lines.every((l) => l.remaining <= 0)
  const isFull = chosen.length > 0 && parsed.every((p) => Math.abs(p.value - p.line.remaining) < 0.0005)

  const fillAll = () => setQty(Object.fromEntries(lines.map((l) => [l.id, l.remaining > 0 ? String(l.remaining) : ''])))
  const clearAll = () => setQty({})

  const submit = async () => {
    setError(null)
    if (!returnDate) return setError('Enter the return date')
    if (returnDate < saleDate) return setError('The return date cannot be before the sale date')
    if (hasErrors) return setError('Fix the highlighted quantities first')
    if (chosen.length === 0) return setError('Enter a return quantity on at least one line')

    setSaving(true)
    try {
      const res = await fetch(`/api/dispatch/${orderId}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_id: returnId,
          return_date: returnDate,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
          items: chosen.map((p) => ({ dispatch_item_id: p.line.id, quantity: round3(p.value) })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Could not save the return')
        setSaving(false)
        return
      }
      router.push(`/sale-returns/${data.id}`)
      router.refresh()
    } catch {
      setError('Network error — please try again (it is safe to press Save again; the return will not be entered twice)')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Return Date *</label>
            <DateInput
              value={returnDate}
              min={saleDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Reason</label>
            <input
              list="sale-return-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Damaged"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
            <datalist id="sale-return-reasons">
              {REASONS.map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Vehicle, credit note no., …"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Returned Items</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={fillAll}
              disabled={nothingLeft || saving}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              Return everything remaining
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item Code</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Line</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Sold</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Already Returned</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Can Return</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Return Qty (MT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parsed.map(({ line: l, invalid, over }) => (
                <tr key={l.id} className={l.remaining <= 0 ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'}>
                  <td className="px-3 py-2 text-[0.8125rem] font-mono text-gray-700">{l.itemCode ?? '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-900">
                    {l.itemName ?? l.material ?? '—'}
                    {l.saleLineId && <span className="block text-[10px] font-mono text-green-700">{l.saleLineId}</span>}
                  </td>
                  <td className="px-3 py-2 text-[0.8125rem] font-mono text-blue-700">{l.purchaseLineId ?? '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-gray-700">{l.size ?? '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-right">{l.sold.toFixed(3)}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-right">{l.alreadyReturned > 0 ? l.alreadyReturned.toFixed(3) : '—'}</td>
                  <td className="px-3 py-2 text-[0.8125rem] text-right font-medium">{l.remaining.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right">
                    {l.remaining > 0 ? (
                      <>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.001"
                          min="0"
                          max={l.remaining}
                          value={qty[l.id] ?? ''}
                          onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                          disabled={saving}
                          placeholder="0.000"
                          className={`w-32 rounded-lg border px-2 py-1 text-sm text-right focus:outline-none ${
                            invalid || over ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-400'
                          }`}
                        />
                        {over && <span className="block text-[11px] text-red-600 mt-0.5">Max {l.remaining.toFixed(3)}</span>}
                      </>
                    ) : (
                      <span className="text-xs">Fully returned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td colSpan={7} className="px-3 py-2 text-[0.8125rem] font-semibold text-gray-900 text-right">
                  {chosen.length === 0 ? 'Total returned' : isFull ? 'Total returned (full return)' : 'Total returned (partial return)'}
                </td>
                <td className="px-3 py-2 text-[0.8125rem] font-bold text-gray-900 text-right">{totalQty.toFixed(3)} MT</td>
              </tr>
              {totalAmount > 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-1 text-xs text-gray-500 text-right">Value at sale rate (before tax)</td>
                  <td className="px-3 py-1 text-xs text-gray-700 text-right">{formatCurrency(totalAmount)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <button
          type="button"
          onClick={submit}
          disabled={saving || chosen.length === 0 || hasErrors}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Return'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={saving}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <p className="text-xs text-gray-500">
          Saving adds the returned quantity back to stock. A saved return can’t be edited — cancel it and enter it again if it’s wrong.
        </p>
      </div>
    </div>
  )
}
