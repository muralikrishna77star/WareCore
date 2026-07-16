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
  CREATE_JOB_WORK_ORDER_MUTATION,
  CREATE_JOB_WORK_ITEMS_MUTATION,
  UPDATE_JOB_WORK_ITEM_TRANSFERRED_OUT_MUTATION,
  CREATE_JOB_WORK_TRANSFER_MUTATION,
  CREATE_JOB_WORK_TRANSFER_ITEMS_MUTATION,
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

export default function JobWorkTransferPage() {
  const router = useRouter()
  const params = useParams()
  const sourceId = params.id as string

  const [order, setOrder] = useState<any>(null)
  const [suppliers, setSuppliers] = useState<any[]>([])
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
      hasuraFetch(JOB_WORK_ORDER_BY_ID_QUERY, { id: sourceId }),
      hasuraFetch(JOB_WORK_ITEMS_QUERY, { job_work_order_id: sourceId }),
      hasuraFetch(ACTIVE_SUPPLIERS_QUERY),
      hasuraFetch(ALL_JOB_WORK_LINE_IDS_QUERY),
      hasuraFetch(ALL_JOB_WORK_TRANSFER_NUMBERS_QUERY),
    ]).then(([orderRes, itemsRes, supRes, lineIdRes, transferNumRes]) => {
      const jwo = (orderRes.data as any)?.job_work_orders_by_pk
      const items = (itemsRes.data as any)?.job_work_items ?? []
      setOrder(jwo)
      setSuppliers((supRes.data as any)?.suppliers ?? [])
      const lineIds: string[] = ((lineIdRes.data as any)?.job_work_items ?? []).map((i: any) => i.job_line_id).filter(Boolean)
      setExistingJobLineIds(lineIds)
      const transferNums: string[] = ((transferNumRes.data as any)?.job_work_transfers ?? []).map((t: any) => t.transfer_number).filter(Boolean)
      setExistingTransferNumbers(transferNums)

      setLines(
        items
          .map((item: any): TransferLine => {
            const pending = Number(item.quantity_sent) - Number(item.quantity_received ?? 0) - Number(item.quantity_transferred_out ?? 0)
            return {
              sourceItemId: item.id,
              itemName: item.item_name ?? item.material_types?.description ?? '',
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

    const { data: orderData, error: oErr } = await hasuraFetch<any>(CREATE_JOB_WORK_ORDER_MUTATION, {
      reference_number: referenceNumber,
      company_id: order.company_id,
      warehouse_id: order.warehouse_id,
      vendor_id: targetVendorId,
      dispatch_date: transferDate,
      expected_return_date: order.expected_return_date || null,
      work_description: `Transferred from ${order.reference_number}`,
      status: 'dispatched',
      notes: reason || null,
    })
    const newOrder = orderData?.insert_job_work_orders_one
    if (oErr || !newOrder) { setError(oErr?.message ?? 'Failed to create new job work order'); setSaving(false); return }

    const ddmm = getDDMM(new Date(transferDate + 'T00:00:00'))
    const usedLineIds = [...existingJobLineIds]
    const itemObjects = validLines.map(l => {
      const jobLineId = generateJobLineId(ddmm, usedLineIds)
      usedLineIds.push(jobLineId)
      return {
        job_work_order_id: newOrder.id,
        purchase_line_id: l.purchaseLineId || null,
        sub_purchase_line_id: l.subPurchaseLineId || null,
        job_line_id: jobLineId,
        item_master_id: l.itemMasterId || null,
        item_name: l.itemName || null,
        material_type_id: l.materialTypeId || null,
        material_size_id: l.materialSizeId || null,
        size_label: l.sizeLabel || null,
        quantity_sent: parseFloat(l.quantity),
        quantity_received: 0,
        unit: l.unit,
        is_transfer_line: true,
        source_job_work_item_id: l.sourceItemId,
        notes: `Transferred from ${order.reference_number}`,
      }
    })

    const { error: iErr } = await hasuraFetch(CREATE_JOB_WORK_ITEMS_MUTATION, { objects: itemObjects })
    if (iErr) { setError(iErr.message); setSaving(false); return }

    for (const l of validLines) {
      await hasuraFetch(UPDATE_JOB_WORK_ITEM_TRANSFERRED_OUT_MUTATION, {
        id: l.sourceItemId,
        quantity_transferred_out: l.existingTransferredOut + parseFloat(l.quantity),
      })
    }

    const { data: transferData, error: tErr } = await hasuraFetch<any>(CREATE_JOB_WORK_TRANSFER_MUTATION, {
      transfer_number: transferNumber,
      transfer_date: transferDate,
      from_job_work_order_id: sourceId,
      from_vendor_id: order.vendor_id,
      to_job_work_order_id: newOrder.id,
      to_vendor_id: targetVendorId,
      reason: reason || null,
      notes: notes || null,
    })
    const transfer = transferData?.insert_job_work_transfers_one
    if (tErr || !transfer) { setError(tErr?.message ?? 'Failed to record transfer'); setSaving(false); return }

    const transferItemObjects = validLines.map(l => ({
      job_work_transfer_id: transfer.id,
      from_job_work_item_id: l.sourceItemId,
      purchase_line_id: l.purchaseLineId || null,
      sub_purchase_line_id: l.subPurchaseLineId || null,
      item_master_id: l.itemMasterId || null,
      item_name: l.itemName || null,
      material_type_id: l.materialTypeId || null,
      material_size_id: l.materialSizeId || null,
      size_label: l.sizeLabel || null,
      quantity_transferred: parseFloat(l.quantity),
      unit: l.unit,
    }))
    await hasuraFetch(CREATE_JOB_WORK_TRANSFER_ITEMS_MUTATION, { objects: transferItemObjects })

    router.push(`/jobwork/${newOrder.id}`)
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
                {targetVendorOptions.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
