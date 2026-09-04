'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  JOB_WORK_ORDER_BY_ID_QUERY,
  JOB_WORK_OUTPUT_ITEMS_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ALL_JOB_WORK_LINE_IDS_QUERY,
} from '@/lib/hasura/queries'
import { generateReferenceNumber } from '@/lib/utils'

// ─── Job Line ID generation (format JW-DDMM-NNNN) — same convention as jobwork/new ──

function getDDMM(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}${mm}`
}

function generateJobLineId(ddmm: string, allJobLineIds: string[]): string {
  const prefix = `JW-${ddmm}-`
  const maxSeq = allJobLineIds.reduce((max, id) => {
    if (!id || !id.startsWith(prefix)) return max
    const n = parseInt(id.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`
}

type OutputLine = {
  sourceOutputItemId: string
  itemName: string
  itemCode: string
  sizeLabel: string
  unit: string
  producedQty: number
  alreadyConsumed: number
  remainingQty: number
  quantity: string
}

interface SourceOrder {
  reference_number: string
  suppliers: { name: string } | null
}

interface SourceOutputItem {
  id: string
  item_name: string | null
  size_label: string | null
  quantity: number
  quantity_consumed: number | null
  unit: string
  material_type_id: string | null
  material_types: { description: string } | null
  item_master: { item_code: string | null } | null
}

interface SupplierOption {
  id: string
  name: string
}

export default function JobWorkSendOutputPage() {
  const router = useRouter()
  const params = useParams()
  const sourceId = params.id as string

  const [order, setOrder] = useState<SourceOrder | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [existingJobLineIds, setExistingJobLineIds] = useState<string[]>([])
  const [lines, setLines] = useState<OutputLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [targetVendorId, setTargetVendorId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [workDescription, setWorkDescription] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    Promise.all([
      hasuraFetch<{ job_work_orders_by_pk: SourceOrder | null }>(JOB_WORK_ORDER_BY_ID_QUERY, { id: sourceId }),
      hasuraFetch<{ job_work_output_items: SourceOutputItem[] }>(JOB_WORK_OUTPUT_ITEMS_QUERY, { job_work_order_id: sourceId }),
      hasuraFetch<{ suppliers: SupplierOption[] }>(ACTIVE_SUPPLIERS_QUERY),
      hasuraFetch<{ job_work_items: { job_line_id: string | null }[] }>(ALL_JOB_WORK_LINE_IDS_QUERY),
    ]).then(([orderRes, outputRes, supRes, lineIdRes]) => {
      const jwo = orderRes.data?.job_work_orders_by_pk ?? null
      const outputItems = outputRes.data?.job_work_output_items ?? []
      setOrder(jwo)
      setSuppliers(supRes.data?.suppliers ?? [])
      const lineIds = (lineIdRes.data?.job_work_items ?? [])
        .map((i) => i.job_line_id)
        .filter((id): id is string => Boolean(id))
      setExistingJobLineIds(lineIds)

      setLines(
        outputItems
          .filter((item) => item.material_type_id != null)
          .map((item): OutputLine => {
            const produced = Number(item.quantity)
            const consumed = Number(item.quantity_consumed ?? 0)
            const remaining = produced - consumed
            return {
              sourceOutputItemId: item.id,
              itemName: item.item_name ?? item.material_types?.description ?? '',
              itemCode: item.item_master?.item_code ?? '',
              sizeLabel: item.size_label ?? '',
              unit: item.unit ?? 'MT',
              producedQty: produced,
              alreadyConsumed: consumed,
              remainingQty: remaining,
              quantity: remaining > 0 ? remaining.toFixed(3) : '0',
            }
          })
          .filter((l: OutputLine) => l.remainingQty > 0)
      )
      setLoading(false)
    })
  }, [sourceId])

  function updateLine(i: number, value: string) {
    setLines(prev => {
      const updated = [...prev]
      updated[i] = { ...updated[i], quantity: value }
      return updated
    })
  }

  const totalQty = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0)

  async function handleSave() {
    if (!order) return
    if (!targetVendorId) { setError('Select a target vendor.'); return }
    const validLines = lines.filter(l => {
      const qty = parseFloat(l.quantity) || 0
      return qty > 0 && qty <= l.remainingQty
    })
    if (!validLines.length) { setError('No output items to send.'); return }

    setSaving(true); setError('')

    const referenceNumber = generateReferenceNumber('JW')
    const ddmm = getDDMM(new Date(dispatchDate + 'T00:00:00'))
    const usedLineIds = [...existingJobLineIds]
    const linePayload = validLines.map(l => {
      const jobLineId = generateJobLineId(ddmm, usedLineIds)
      usedLineIds.push(jobLineId)
      return { source_output_item_id: l.sourceOutputItemId, job_line_id: jobLineId, quantity: parseFloat(l.quantity) }
    })

    // Single atomic database call — new order, its input line(s), and each
    // source output line's quantity_consumed all commit together or not at
    // all (see migration 138).
    const res = await fetch(`/api/jobwork/${sourceId}/send-output`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_vendor_id: targetVendorId,
        dispatch_date: dispatchDate,
        reference_number: referenceNumber,
        expected_return_date: expectedReturnDate || null,
        work_description: workDescription || null,
        notes: notes || null,
        lines: linePayload,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || `Server error (${res.status})`); setSaving(false); return }

    router.push(`/jobwork/${data.jobWorkOrderId}`)
    router.refresh()
  }

  const fieldCls = 'block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none'

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!order) return <div className="p-8 text-center text-gray-400 text-sm">Job work order not found.</div>

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-b border-indigo-200">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Send Output to Another Vendor</h1>
            <p className="text-xs text-indigo-700 mt-0.5">
              Produced by {order.suppliers?.name} · Order {order.reference_number} — starts a new job work order for the next processing stage
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/jobwork/${sourceId}`} className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </Link>
            <button type="button" onClick={handleSave} disabled={saving}
              className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Sending…' : 'Confirm & Create Order'}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-gray-200">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Target Vendor *</label>
              <select value={targetVendorId} onChange={e => setTargetVendorId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Dispatch Date</label>
              <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Expected Return</label>
              <input type="date" value={expectedReturnDate} onChange={e => setExpectedReturnDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Work Description</label>
              <input value={workDescription} onChange={e => setWorkDescription(e.target.value)} placeholder="e.g. Galvanizing" className={fieldCls} />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={fieldCls} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-indigo-50 border-b border-indigo-100">
          <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Output Lines Available to Send</span>
          {lines.length === 0 && <span className="text-xs text-indigo-600">No output remaining on this order</span>}
        </div>

        {lines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Item Code</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Item</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Size</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Produced</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Already Sent</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Remaining</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Qty to Send</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const qty = parseFloat(line.quantity) || 0
                  const overQty = qty > line.remainingQty
                  return (
                    <tr key={line.sourceOutputItemId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{line.itemCode || '—'}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{line.itemName || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{line.sizeLabel || '—'}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{line.producedQty.toFixed(3)} {line.unit}</td>
                      <td className="px-3 py-2 text-sm text-gray-500 whitespace-nowrap">{line.alreadyConsumed.toFixed(3)} {line.unit}</td>
                      <td className="px-3 py-2 text-sm font-semibold text-gray-700 whitespace-nowrap">
                        {line.remainingQty.toFixed(3)} {line.unit}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={line.quantity}
                          onChange={e => updateLine(i, e.target.value)}
                          step="0.001" min="0.001" max={line.remainingQty}
                          className={`block w-28 rounded border px-2 py-1.5 text-sm focus:outline-none ${overQty ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`} />
                        {overQty && <p className="text-[10px] text-red-600 mt-0.5 whitespace-nowrap">Exceeds remaining</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={5} className="px-3 py-3 text-sm font-semibold text-right">Total:</td>
                  <td className="px-3 py-3 text-sm font-bold" colSpan={2}>{totalQty.toFixed(3)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}

        {error && (
          <div className="border-t border-red-200 bg-red-50 px-4 py-2">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
