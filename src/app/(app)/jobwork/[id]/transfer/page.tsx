'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  JOB_WORK_ORDER_BY_ID_QUERY,
  JOB_WORK_ITEMS_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ALL_JOB_WORK_LINE_IDS_QUERY,
  ALL_JOB_WORK_TRANSFER_NUMBERS_QUERY,
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

function getMMYY(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}${yy}`
}
function generateTransferNumber(existing: string[]) {
  const prefix = `JWT-${getMMYY()}-`
  const maxSeq = existing.reduce((max, id) => {
    if (!id || !id.startsWith(prefix)) return max
    const n = parseInt(id.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`
}

type TransferLine = {
  sourceItemId: string
  itemName: string
  itemCode: string
  purchaseLineId: string
  subPurchaseLineId: string
  itemMasterId: string
  materialTypeId: string
  materialSizeId: string | null
  sizeLabel: string
  unit: string
  pendingQty: number
  existingTransferredOut: number
  quantity: string
}

interface TransferOrder {
  vendor_id: string
  company_id: string
  warehouse_id: string
  reference_number: string
  expected_return_date: string | null
  suppliers: { name: string } | null
}

interface TransferSourceItem {
  id: string
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  quantity_sent: number
  quantity_received: number | null
  quantity_transferred_out: number | null
  size_label: string | null
  unit: string | null
  item_master_id: string | null
  item_name: string | null
  material_type_id: string
  material_size_id: string | null
  material_types: { description: string } | null
  material_sizes: { size_label: string } | null
  item_master: { item_code: string | null } | null
}

interface SupplierOption {
  id: string
  name: string
}

export default function JobWorkTransferPage() {
  const router = useRouter()
  const params = useParams()
  const sourceId = params.id as string

  const [order, setOrder] = useState<TransferOrder | null>(null)
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [existingJobLineIds, setExistingJobLineIds] = useState<string[]>([])
  const [existingTransferNumbers, setExistingTransferNumbers] = useState<string[]>([])
  const [lines, setLines] = useState<TransferLine[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [targetVendorId, setTargetVendorId] = useState('')
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0])
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    Promise.all([
      hasuraFetch<{ job_work_orders_by_pk: TransferOrder | null }>(JOB_WORK_ORDER_BY_ID_QUERY, { id: sourceId }),
      hasuraFetch<{ job_work_items: TransferSourceItem[] }>(JOB_WORK_ITEMS_QUERY, { job_work_order_id: sourceId }),
      hasuraFetch<{ suppliers: SupplierOption[] }>(ACTIVE_SUPPLIERS_QUERY),
      hasuraFetch<{ job_work_items: { job_line_id: string | null }[] }>(ALL_JOB_WORK_LINE_IDS_QUERY),
      hasuraFetch<{ job_work_transfers: { transfer_number: string | null }[] }>(ALL_JOB_WORK_TRANSFER_NUMBERS_QUERY),
    ]).then(([orderRes, itemsRes, supRes, lineIdRes, transferNumRes]) => {
      const jwo = orderRes.data?.job_work_orders_by_pk ?? null
      const items = itemsRes.data?.job_work_items ?? []
      setOrder(jwo)
      setSuppliers(supRes.data?.suppliers ?? [])
      const lineIds = (lineIdRes.data?.job_work_items ?? [])
        .map((i) => i.job_line_id)
        .filter((id): id is string => Boolean(id))
      setExistingJobLineIds(lineIds)
      const transferNums = (transferNumRes.data?.job_work_transfers ?? [])
        .map((t) => t.transfer_number)
        .filter((n): n is string => Boolean(n))
      setExistingTransferNumbers(transferNums)

      setLines(
        items
          .map((item): TransferLine => {
            const pending = Number(item.quantity_sent) - Number(item.quantity_received ?? 0) - Number(item.quantity_transferred_out ?? 0)
            return {
              sourceItemId: item.id,
              itemName: item.item_name ?? item.material_types?.description ?? '',
              itemCode: item.item_master?.item_code ?? '',
              purchaseLineId: item.purchase_line_id ?? '',
              subPurchaseLineId: item.sub_purchase_line_id ?? '',
              itemMasterId: item.item_master_id ?? '',
              materialTypeId: item.material_type_id,
              materialSizeId: item.material_size_id ?? null,
              sizeLabel: item.size_label ?? item.material_sizes?.size_label ?? '',
              unit: item.unit ?? 'MT',
              pendingQty: pending,
              existingTransferredOut: Number(item.quantity_transferred_out ?? 0),
              quantity: pending > 0 ? pending.toFixed(3) : '0',
            }
          })
          .filter((l: TransferLine) => l.pendingQty > 0)
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
  const targetVendorOptions = suppliers.filter(s => s.id !== order?.vendor_id)

  async function handleSave() {
    if (!order) return
    if (!targetVendorId) { setError('Select a target vendor.'); return }
    const validLines = lines.filter(l => {
      const qty = parseFloat(l.quantity) || 0
      return qty > 0 && qty <= l.pendingQty
    })
    if (!validLines.length) { setError('No items to transfer.'); return }

    setSaving(true); setError('')

    const referenceNumber = generateReferenceNumber('JW')
    const transferNumber = generateTransferNumber(existingTransferNumbers)
    const ddmm = getDDMM(new Date(transferDate + 'T00:00:00'))
    const usedLineIds = [...existingJobLineIds]
    const linePayload = validLines.map(l => {
      const jobLineId = generateJobLineId(ddmm, usedLineIds)
      usedLineIds.push(jobLineId)
      return { source_item_id: l.sourceItemId, job_line_id: jobLineId, quantity: parseFloat(l.quantity) }
    })

    // Single atomic database call — order, items, source-side
    // quantity_transferred_out, transfer audit row, and transfer items all
    // commit together or not at all, so a failure partway through can never
    // leave the ledger silently unposted while everything else looks done.
    const res = await fetch(`/api/jobwork/${sourceId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_vendor_id: targetVendorId,
        transfer_date: transferDate,
        reference_number: referenceNumber,
        transfer_number: transferNumber,
        reason: reason || null,
        notes: notes || null,
        lines: linePayload,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || `Server error (${res.status})`); setSaving(false); return }

    router.push(`/jobwork/${data.toJobWorkOrderId}`)
    router.refresh()
  }

  const fieldCls = 'block w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none'

  if (loading) return <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
  if (!order) return <div className="p-8 text-center text-gray-400 text-sm">Job work order not found.</div>

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-200">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Transfer Job Work to Another Vendor</h1>
            <p className="text-xs text-amber-700 mt-0.5">
              From {order.suppliers?.name} · Order {order.reference_number}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/jobwork/${sourceId}`} className="rounded border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Cancel
            </Link>
            <button type="button" onClick={handleSave} disabled={saving}
              className="rounded bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Transferring…' : 'Confirm Transfer'}
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-gray-200">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Target Vendor *</label>
              <select value={targetVendorId} onChange={e => setTargetVendorId(e.target.value)} className={fieldCls}>
                <option value="">— Select —</option>
                {targetVendorOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Transfer Date</label>
              <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Vendor delay" className={fieldCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className={fieldCls} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-100">
          <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Pending Items to Transfer</span>
          {lines.length === 0 && <span className="text-xs text-amber-600">No pending items on this order</span>}
        </div>

        {lines.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Item Code</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Item</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Purchase Line</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Size</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Pending</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Qty to Transfer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((line, i) => {
                  const qty = parseFloat(line.quantity) || 0
                  const overQty = qty > line.pendingQty
                  return (
                    <tr key={line.sourceItemId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{line.itemCode || '—'}</td>
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{line.itemName || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-blue-700 whitespace-nowrap">{line.purchaseLineId || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{line.sizeLabel || '—'}</td>
                      <td className="px-3 py-2 text-sm font-semibold text-gray-700 whitespace-nowrap">
                        {line.pendingQty.toFixed(3)} {line.unit}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" value={line.quantity}
                          onChange={e => updateLine(i, e.target.value)}
                          step="0.001" min="0.001" max={line.pendingQty}
                          className={`block w-28 rounded border px-2 py-1.5 text-sm focus:outline-none ${overQty ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-500'}`} />
                        {overQty && <p className="text-[10px] text-red-600 mt-0.5 whitespace-nowrap">Exceeds pending</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={3} className="px-3 py-3 text-sm font-semibold text-right">Total:</td>
                  <td className="px-3 py-3 text-sm font-bold">{totalQty.toFixed(3)}</td>
                  <td />
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
