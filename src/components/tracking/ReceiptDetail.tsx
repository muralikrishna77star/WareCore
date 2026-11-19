'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { LifecycleStatus, OutputReceipt, TrackingUnit } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'
import { LifecycleBadge } from './StatusBadge'

interface SourceRow {
  child_id: string
  unit_id: string
  stock_tracking_id: string
  item_code: string | null
  item_name: string | null
  size_label: string | null
  quantity: string
  unit: string
  lifecycle_status: LifecycleStatus
  purchase_line_id: string | null
  relation: 'MADE_FROM' | 'REMAINDER_OF'
}

interface Detail {
  receipt: OutputReceipt
  units: TrackingUnit[]
  sources: SourceRow[]
  warnings: string[]
}

interface Order {
  id: string
  reference_number: string
  dispatch_date: string
  quantity: string
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const quiet = 'rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export function ReceiptDetail({ receiptId, canOperate, canLabel }: { receiptId: string; canOperate: boolean; canLabel: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [orderSearch, setOrderSearch] = useState('')
  const [orders, setOrders] = useState<Order[] | null>(null)

  const fetchDetail = useCallback(() => trackingApi<Detail>(`outputs/${receiptId}`), [receiptId])
  const load = useCallback(async () => {
    try {
      setDetail(await fetchDetail())
    } catch (err) {
      setError(errorText(err))
    }
  }, [fetchDetail])

  useEffect(() => {
    let current = true
    fetchDetail().then((data) => { if (current) setDetail(data) }).catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchDetail])

  const link = async (orderId: string | null) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await trackingApi(`outputs/${receiptId}`, { method: 'POST', body: { action: 'link_order', order_id: orderId } })
      setNotice(orderId ? 'Job work order linked' : 'Job work order unlinked')
      setOrders(null)
      await load()
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  const findOrders = async () => {
    try {
      setOrders((await trackingApi<{ orders: Order[] }>(`outputs/${receiptId}?orders=${encodeURIComponent(orderSearch)}`)).orders)
    } catch (err) {
      setError(errorText(err))
    }
  }

  if (!detail) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const { receipt, units, sources, warnings } = detail
  const unlabelled = units.filter((u) => u.status === 'ACTIVE' && u.lifecycle_status === 'LABELLED')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/tracking/outputs" className="text-sm text-blue-600 hover:underline">Back to outputs</Link>

      {warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
        </p>
      ))}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-mono text-xl font-semibold text-gray-900">{receipt.receipt_no}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-500">From vendor</dt><dd className="font-medium text-gray-900">{receipt.vendor_name}</dd></div>
          <div><dt className="text-gray-500">Arrived at</dt><dd className="text-gray-900">{receipt.company_name} · {receipt.warehouse_name}</dd></div>
          <div><dt className="text-gray-500">Received on</dt><dd className="text-gray-900">{receipt.received_on}</dd></div>
          <div><dt className="text-gray-500">Job work order</dt><dd className="text-gray-900">{receipt.job_work_reference ?? 'Not linked'}</dd></div>
          {receipt.dispatch_no && <div><dt className="text-gray-500">Sent on</dt><dd className="font-mono text-gray-900">{receipt.dispatch_no}</dd></div>}
          <div><dt className="text-gray-500">Saved</dt><dd className="text-gray-900">{formatWhen(receipt.created_at)}</dd></div>
          {receipt.note && <div className="col-span-2"><dt className="text-gray-500">Note</dt><dd className="text-gray-900">{receipt.note}</dd></div>}
        </dl>
      </section>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h3 className="px-4 pt-4 font-semibold text-gray-900">Bundles received</h3>
        <table className="mt-2 min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">Tracking ID</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Weight</th>
              <th className="px-4 py-2">Made from</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {units.map((unit) => (
              <tr key={unit.id}>
                <td className="whitespace-nowrap px-4 py-2 font-mono">
                  <Link href={`/tracking/units/${unit.id}`} className="text-blue-600 hover:underline">{unit.stock_tracking_id}</Link>
                  <span className="block font-sans text-xs text-gray-500">{unit.source_type === 'JOB_WORK_REMAINDER' ? 'Remainder' : 'Output'}</span>
                </td>
                <td className="px-4 py-2 text-gray-700">{unit.item_code} {unit.item_name} {unit.size_label}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-gray-900">{unit.quantity} {unit.unit}</td>
                <td className="px-4 py-2 text-gray-700">
                  {sources.filter((s) => s.child_id === unit.id).map((s) => (
                    <span key={s.unit_id} className="block">
                      <Link href={`/tracking/units/${s.unit_id}`} className="font-mono text-blue-600 hover:underline">{s.stock_tracking_id}</Link>
                      <span className="ml-1 text-xs text-gray-500">{s.purchase_line_id ?? 'mixed lines'} · {s.quantity} {s.unit}</span>
                    </span>
                  ))}
                </td>
                <td className="px-4 py-2"><LifecycleBadge status={unit.lifecycle_status} voided={unit.status === 'VOIDED'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {canLabel && unlabelled.length > 0 && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Print labels</h3>
          <LabelPrintPanel units={unlabelled} onChanged={load} />
        </section>
      )}

      {canOperate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Job work order</h3>
          {receipt.job_work_order_id ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-gray-900">{receipt.job_work_reference}</span>
              <button type="button" disabled={busy} onClick={() => link(null)} className={quiet}>Unlink</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">Linking matches each output to an output line of the order by item, then size, then weight.</p>
              <div className="flex max-w-md gap-2">
                <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Search order reference" className={field} />
                <button type="button" onClick={findOrders} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Find</button>
              </div>
              {orders?.length === 0 && <p className="text-sm text-gray-600">No open job work orders were found for {receipt.vendor_name}.</p>}
              {!!orders?.length && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {orders.map((order) => (
                    <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-gray-800">{order.reference_number} · {order.dispatch_date} · {order.quantity} sent</span>
                      <button type="button" disabled={busy} onClick={() => link(order.id)} className={quiet}>Link</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
