'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { DispatchLine, VendorDispatch } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { ScanInput } from './ScanInput'
import { DispatchBadge, LifecycleBadge } from './StatusBadge'
import { useGpsCapture } from './useGpsCapture'

interface Detail {
  dispatch: VendorDispatch
  lines: DispatchLine[]
  warnings: string[]
}

interface Order {
  id: string
  reference_number: string
  dispatch_date: string
  status: string
  quantity: string
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const primary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
const quiet = 'rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50'

export function DispatchDetail({ dispatchId, canOperate, canManage }: { dispatchId: string; canOperate: boolean; canManage: boolean }) {
  const capturePosition = useGpsCapture()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [orders, setOrders] = useState<Order[] | null>(null)

  const fetchDetail = useCallback(() => trackingApi<Detail>(`dispatches/${dispatchId}`), [dispatchId])

  const load = useCallback(async () => {
    try {
      setDetail(await fetchDetail())
    } catch (err) {
      setError(errorText(err))
    }
  }, [fetchDetail])

  useEffect(() => {
    let current = true
    fetchDetail()
      .then((data) => {
        if (!current) return
        setDetail(data)
        setVehicle(data.dispatch.vehicle_number ?? '')
      })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchDetail])

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await trackingApi(`dispatches/${dispatchId}`, { method: 'POST', body })
      setNotice(done)
      await load()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const findOrders = async () => {
    setError('')
    try {
      setOrders((await trackingApi<{ orders: Order[] }>(`dispatches/${dispatchId}?orders=${encodeURIComponent(orderSearch)}`)).orders)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const send = async () => {
    const position = detail ? await capturePosition(detail.dispatch.company_id) : null
    await act({ action: 'send', vehicle_number: vehicle, position }, 'Dispatch sent. Every bundle on it is now at the vendor')
  }

  if (!detail) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const { dispatch, lines, warnings } = detail
  const open = dispatch.status === 'OPEN'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/tracking/dispatches" className="text-sm text-blue-600 hover:underline">Back to dispatches</Link>

      {warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
        </p>
      ))}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-xl font-semibold text-gray-900">{dispatch.dispatch_no}</h2>
          <DispatchBadge status={dispatch.status} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-500">Vendor</dt><dd className="font-medium text-gray-900">{dispatch.vendor_name}</dd></div>
          <div><dt className="text-gray-500">From</dt><dd className="text-gray-900">{dispatch.company_name} · {dispatch.warehouse_name}</dd></div>
          <div><dt className="text-gray-500">Total</dt><dd className="font-medium text-gray-900">{dispatch.bundle_count} {dispatch.bundle_count === 1 ? 'bundle' : 'bundles'}, {dispatch.total_quantity} {dispatch.unit}</dd></div>
          <div><dt className="text-gray-500">Job work order</dt><dd className="text-gray-900">{dispatch.job_work_reference ?? 'Not linked'}</dd></div>
          {dispatch.vehicle_number && <div><dt className="text-gray-500">Vehicle</dt><dd className="font-mono text-gray-900">{dispatch.vehicle_number}</dd></div>}
          {dispatch.sent_at && <div><dt className="text-gray-500">Sent</dt><dd className="text-gray-900">{formatWhen(dispatch.sent_at)}</dd></div>}
          {dispatch.cancel_reason && <div><dt className="text-gray-500">Cancelled because</dt><dd className="text-gray-900">{dispatch.cancel_reason}</dd></div>}
        </dl>
      </section>

      {open && canOperate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <ScanInput id="dispatch-bundle" label="Scan each bundle as it is loaded" placeholder="ST2611-000001" buttonLabel="Add" busy={busy} autoFocus
            onScan={async (code) => { await act({ action: 'add_unit', code }, 'Bundle added') }} />
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h3 className="px-4 pt-4 font-semibold text-gray-900">Bundles</h3>
        {lines.length === 0 && <p className="px-4 py-3 text-sm text-gray-600">No bundles scanned yet.</p>}
        {lines.length > 0 && (
          <table className="mt-2 min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Tracking ID</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Purchase line</th>
                <th className="px-4 py-2 text-right">Weight</th>
                <th className="px-4 py-2">Order line</th>
                <th className="px-4 py-2">Now</th>
                {open && canOperate && <th className="px-4 py-2"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.unit_id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono"><Link href={`/tracking/units/${line.unit_id}`} className="text-blue-600 hover:underline">{line.stock_tracking_id}</Link></td>
                  <td className="px-4 py-2 text-gray-700">{line.item_code} {line.item_name} {line.size_label}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-700">{line.purchase_line_id ?? 'Mixed'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-gray-900">{line.quantity} {line.unit}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-700">{line.job_line_id ?? (dispatch.job_work_order_id ? 'No match' : '')}</td>
                  <td className="px-4 py-2">
                    <LifecycleBadge status={line.lifecycle_status} />
                    {line.closed_reason && <span className="block text-xs text-gray-500">{line.closed_reason}</span>}
                  </td>
                  {open && canOperate && (
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {removing === line.unit_id ? (
                        <span className="flex items-center justify-end gap-2">
                          <input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Reason" className="w-36 rounded border border-gray-300 px-2 py-1 text-sm" />
                          <button
                            type="button"
                            disabled={busy || !removeReason.trim()}
                            onClick={async () => {
                              if (await act({ action: 'remove_unit', unit_id: line.unit_id, reason: removeReason }, 'Bundle removed')) {
                                setRemoving(null)
                                setRemoveReason('')
                              }
                            }}
                            className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-800 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => { setRemoving(line.unit_id); setRemoveReason('') }} className={quiet}>Remove</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open && canOperate && lines.length > 0 && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Mark sent</h3>
          <p className="text-sm text-gray-600">Every bundle above moves to {dispatch.vendor_name} together.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Vehicle number</span>
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} className={`${field} font-mono`} />
            </label>
            <button type="button" disabled={busy} onClick={send} className={primary}>Mark sent</button>
          </div>
        </section>
      )}

      {dispatch.status !== 'CANCELLED' && canOperate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Job work order</h3>
          {dispatch.job_work_order_id ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-gray-900">{dispatch.job_work_reference}</span>
              <button type="button" disabled={busy} onClick={() => act({ action: 'link_order', order_id: null }, 'Job work order unlinked')} className={quiet}>Unlink</button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600">Link the order once it has been entered in Job Work. Each bundle is matched to its input line.</p>
              <div className="flex max-w-md gap-2">
                <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Search order reference" className={field} />
                <button type="button" onClick={findOrders} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Find</button>
              </div>
              {orders?.length === 0 && <p className="text-sm text-gray-600">No open job work orders were found for {dispatch.vendor_name}.</p>}
              {!!orders?.length && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {orders.map((order) => (
                    <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-gray-800">{order.reference_number} · {order.dispatch_date} · {order.quantity} sent</span>
                      <button type="button" disabled={busy} onClick={() => act({ action: 'link_order', order_id: order.id }, 'Job work order linked')} className={quiet}>Link</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {open && canManage && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Cancel dispatch</h3>
          <p className="text-sm text-gray-600">The bundles stay where they are in the warehouse.</p>
          <div className="flex max-w-lg gap-2">
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" className={field} />
            <button type="button" disabled={busy || !cancelReason.trim()} onClick={() => act({ action: 'cancel', reason: cancelReason }, 'Dispatch cancelled')} className="whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Cancel dispatch</button>
          </div>
        </section>
      )}
    </div>
  )
}
