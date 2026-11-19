'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, TriangleAlert } from 'lucide-react'
import type { PickupLine, PickupSummary, TrackingLocation } from '@/lib/tracking/constants'
import { normalizePhone, whatsappUrl } from '@/lib/tracking/whatsapp'
import { errorText, formatWhen, trackingApi } from './api'
import { ScanInput } from './ScanInput'
import { LifecycleBadge, PickupBadge } from './StatusBadge'
import { useGpsCapture } from './useGpsCapture'

interface Detail {
  pickup: PickupSummary
  lines: PickupLine[]
  events: { id: string; event_type: string; occurred_at: string; actor_name: string | null }[]
  warnings: string[]
  message: string
}

interface Sale {
  id: string
  invoice_number: string
  dispatch_date: string
  quantity: string
}

type AddResult = { needsReason: true; message: string } | { needsReason: false }

const EVENT_LABELS: Record<string, string> = {
  PICKUP_CREATED: 'Pickup started',
  UNIT_ADDED: 'Bundle added',
  UNIT_REMOVED: 'Bundle removed',
  MARKED_READY: 'Marked ready',
  WHATSAPP_OPENED: 'WhatsApp opened',
  HANDED_OVER: 'Handed over',
  SALE_LINKED: 'Sale linked',
  SALE_UNLINKED: 'Sale unlinked',
  CANCELLED: 'Pickup cancelled',
  UNIT_RETURNED: 'Bundle returned',
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const primary = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'

export function PickupDetail({ pickupId, canShare, canOperate, canManage }: {
  pickupId: string
  canShare: boolean
  canOperate: boolean
  canManage: boolean
}) {
  const capturePosition = useGpsCapture()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [bays, setBays] = useState<TrackingLocation[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ code: string; message: string } | null>(null)
  const [mismatchReason, setMismatchReason] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [bay, setBay] = useState('')
  const [phone, setPhone] = useState('')
  const [collector, setCollector] = useState({ name: '', phone: '', vehicle: '' })
  const [cancelReason, setCancelReason] = useState('')
  const [saleSearch, setSaleSearch] = useState('')
  const [sales, setSales] = useState<Sale[] | null>(null)

  const fetchDetail = useCallback(() => trackingApi<Detail>(`pickups/${pickupId}`), [pickupId])

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
        setPhone(data.pickup.customer_phone ?? '')
        return trackingApi<{ locations: TrackingLocation[] }>(`locations?warehouse_id=${data.pickup.warehouse_id}`)
      })
      .then((data) => {
        if (current && data) setBays(data.locations.filter((l) => l.location_type === 'PICKUP_BAY' && l.is_active))
      })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchDetail])

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await trackingApi(`pickups/${pickupId}`, { method: 'POST', body })
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

  const addUnit = async (code: string, reason?: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await trackingApi<AddResult>(`pickups/${pickupId}`, { method: 'POST', body: { action: 'add_unit', code, reason } })
      if (result.needsReason) {
        setPending({ code, message: result.message })
      } else {
        setPending(null)
        setMismatchReason('')
        setNotice('Bundle added')
        await load()
      }
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  const findSales = async () => {
    setError('')
    try {
      const data = await trackingApi<{ sales: Sale[] }>(`pickups/${pickupId}?sales=${encodeURIComponent(saleSearch)}`)
      setSales(data.sales)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const handOver = async () => {
    const position = detail ? await capturePosition(detail.pickup.company_id) : null
    await act({ action: 'hand_over', collector_name: collector.name, collector_phone: collector.phone, vehicle_number: collector.vehicle, position }, 'Handed over')
  }

  if (!detail) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const { pickup, lines, events, warnings, message } = detail
  const open = pickup.status === 'OPEN'
  const ready = pickup.status === 'READY'
  const beforeHandover = open || ready
  const whatsappNumber = normalizePhone(phone)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/tracking/pickups" className="text-sm text-blue-600 hover:underline">Back to pickups</Link>

      {warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
        </p>
      ))}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-xl font-semibold text-gray-900">{pickup.pickup_no}</h2>
          <PickupBadge status={pickup.status} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-gray-500">Customer</dt><dd className="font-medium text-gray-900">{pickup.customer_name}</dd></div>
          <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{pickup.warehouse_name}</dd></div>
          <div><dt className="text-gray-500">Total</dt><dd className="font-medium text-gray-900">{pickup.bundle_count} {pickup.bundle_count === 1 ? 'bundle' : 'bundles'}, {pickup.total_quantity} {pickup.unit}</dd></div>
          <div><dt className="text-gray-500">Sale</dt><dd className="text-gray-900">{pickup.invoice_number ?? 'Not linked'}</dd></div>
          {pickup.collector_name && <div><dt className="text-gray-500">Collector</dt><dd className="text-gray-900">{pickup.collector_name}{pickup.collector_phone ? `, ${pickup.collector_phone}` : ''}</dd></div>}
          {pickup.vehicle_number && <div><dt className="text-gray-500">Vehicle</dt><dd className="font-mono text-gray-900">{pickup.vehicle_number}</dd></div>}
          {pickup.handed_over_at && <div><dt className="text-gray-500">Handed over</dt><dd className="text-gray-900">{formatWhen(pickup.handed_over_at)}</dd></div>}
          {pickup.cancel_reason && <div><dt className="text-gray-500">Cancelled because</dt><dd className="text-gray-900">{pickup.cancel_reason}</dd></div>}
        </dl>
      </section>

      {open && canOperate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <ScanInput id="pickup-bundle" label="Scan a bundle onto this pickup" placeholder="ST2611-000001" buttonLabel="Add" busy={busy} autoFocus onScan={(code) => addUnit(code)} />
          {pending && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">{pending.message}</p>
              <input value={mismatchReason} onChange={(e) => setMismatchReason(e.target.value)} placeholder="Reason" className={field} />
              <div className="flex gap-2">
                <button type="button" disabled={busy || !mismatchReason.trim()} onClick={() => addUnit(pending.code, mismatchReason)} className={primary}>Add anyway</button>
                <button type="button" onClick={() => { setPending(null); setMismatchReason('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Do not add</button>
              </div>
            </div>
          )}
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
                <th className="px-4 py-2 text-right">Weight</th>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2">Status</th>
                {beforeHandover && canOperate && <th className="px-4 py-2"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.unit_id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono"><Link href={`/tracking/units/${line.unit_id}`} className="text-blue-600 hover:underline">{line.stock_tracking_id}</Link></td>
                  <td className="px-4 py-2 text-gray-700">
                    {line.item_code} {line.item_name} {line.size_label}
                    {line.mismatch_reason && <span className="block text-xs text-amber-700">Added despite mismatch: {line.mismatch_reason}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-gray-900">{line.quantity} {line.unit}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-700">{line.location_code}</td>
                  <td className="px-4 py-2">{line.returned_at ? <span className="text-xs font-medium text-amber-700">Returned</span> : <LifecycleBadge status={line.lifecycle_status} />}</td>
                  {beforeHandover && canOperate && (
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
                        <button type="button" onClick={() => { setRemoving(line.unit_id); setRemoveReason('') }} className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50">Remove</button>
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
          <h3 className="font-semibold text-gray-900">Mark ready</h3>
          <div className="flex flex-wrap items-end gap-3">
            {bays.length > 0 && (
              <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Pickup bay (optional)</span>
                <select value={bay} onChange={(e) => setBay(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">Leave where they are</option>
                  {bays.map((b) => <option key={b.id} value={b.code}>{b.code}{b.name ? ` · ${b.name}` : ''}</option>)}
                </select>
              </label>
            )}
            <button type="button" disabled={busy} onClick={() => act({ action: 'mark_ready', bay }, 'Pickup is ready')} className={primary}>Mark ready</button>
          </div>
        </section>
      )}

      {pickup.status !== 'CANCELLED' && canShare && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Share on WhatsApp</h3>
          <p className="whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{message}</p>
          <label className="block max-w-xs text-sm text-gray-700">
            <span className="mb-1 block font-medium">Customer&apos;s WhatsApp number</span>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" className={field} />
          </label>
          {phone.trim() && !whatsappNumber && <p className="text-sm text-red-600">Enter a 10-digit mobile number, or include the country code.</p>}
          {whatsappNumber ? (
            <a
              href={whatsappUrl(whatsappNumber, message)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { void act({ action: 'share', phone }, 'WhatsApp opened. Press send there to deliver the message.') }}
              className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
          ) : (
            <button type="button" disabled className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white opacity-50">
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </button>
          )}
        </section>
      )}

      {ready && canOperate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Hand over</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Collector&apos;s name</span>
              <input value={collector.name} onChange={(e) => setCollector({ ...collector, name: e.target.value })} className={field} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Collector&apos;s phone (optional)</span>
              <input inputMode="tel" value={collector.phone} onChange={(e) => setCollector({ ...collector, phone: e.target.value })} className={field} />
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Vehicle number</span>
              <input value={collector.vehicle} onChange={(e) => setCollector({ ...collector, vehicle: e.target.value.toUpperCase() })} className={`${field} font-mono`} />
            </label>
          </div>
          <button type="button" disabled={busy || !collector.name.trim() || !collector.vehicle.trim()} onClick={handOver} className={primary}>Confirm handover</button>
        </section>
      )}

      {pickup.status !== 'CANCELLED' && canShare && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Linked sale</h3>
          {pickup.dispatch_order_id ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-gray-900">{pickup.invoice_number}</span>
              <button type="button" disabled={busy} onClick={() => act({ action: 'link_sale', sale_id: null }, 'Sale unlinked')} className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50">Unlink</button>
            </div>
          ) : (
            <>
              <div className="flex max-w-md gap-2">
                <input value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Search invoice number" className={field} />
                <button type="button" onClick={findSales} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Find</button>
              </div>
              {sales?.length === 0 && <p className="text-sm text-gray-600">No active sales were found for this customer in this warehouse.</p>}
              {!!sales?.length && (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {sales.map((sale) => (
                    <li key={sale.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="text-gray-800">{sale.invoice_number} · {sale.dispatch_date} · {sale.quantity}</span>
                      <button type="button" disabled={busy} onClick={() => act({ action: 'link_sale', sale_id: sale.id }, 'Sale linked')} className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50">Link</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {beforeHandover && canManage && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Cancel pickup</h3>
          <p className="text-sm text-gray-600">Every bundle on this pickup goes back to In stock.</p>
          <div className="flex max-w-lg gap-2">
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" className={field} />
            <button type="button" disabled={busy || !cancelReason.trim()} onClick={() => act({ action: 'cancel', reason: cancelReason }, 'Pickup cancelled')} className="whitespace-nowrap rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Cancel pickup</button>
          </div>
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h3 className="px-4 pt-4 font-semibold text-gray-900">History</h3>
        <table className="mt-2 min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Event</th><th className="px-4 py-2">By</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="whitespace-nowrap px-4 py-2 text-gray-600">{formatWhen(event.occurred_at)}</td>
                <td className="px-4 py-2 text-gray-900">{EVENT_LABELS[event.event_type] ?? event.event_type}</td>
                <td className="px-4 py-2 text-gray-600">{event.actor_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
