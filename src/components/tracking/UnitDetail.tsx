'use client'

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { TriangleAlert } from 'lucide-react'
import type { TrackingUnit } from '@/lib/tracking/constants'
import { errorText, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'

interface Detail {
  unit: TrackingUnit
  warnings: string[]
  events: { id: string; event_type: string; occurred_at: string; actor_name: string | null }[]
  printJobs: { id: string; job_type: string; status: string; reason: string | null; created_at: string; printer_name: string | null; requested_by_name: string | null }[]
}

const EVENT_LABELS: Record<string, string> = {
  UNIT_CREATED: 'Label created',
  LABEL_PRINT_SENT: 'Sent to printer',
  LABEL_PRINT_CONFIRMED: 'Print confirmed',
  LABEL_PRINT_FAILED: 'Print failed',
  SCAN_LOOKUP: 'Scanned',
  UNIT_VOIDED: 'Label voided',
}

const WEIGHT_BASIS: Record<string, string> = { whole_line: 'Whole purchase line', weighed: 'Weighed', estimated: 'Estimated' }

const when = (value: string) => new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export function UnitDetail({ unitId, canPrint, canReprintOrVoid }: { unitId: string; canPrint: boolean; canReprintOrVoid: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  const fetchDetail = useCallback(async () => {
    const data = await trackingApi<Detail>(`units/${unitId}`)
    const image = await QRCode.toDataURL(data.unit.qr_reference, { errorCorrectionLevel: 'Q', margin: 2, width: 160 })
    return { data, image }
  }, [unitId])

  const load = useCallback(async () => {
    try {
      const { data, image } = await fetchDetail()
      setDetail(data)
      setQr(image)
    } catch (err) {
      setError(errorText(err))
    }
  }, [fetchDetail])

  useEffect(() => {
    let current = true
    fetchDetail()
      .then(({ data, image }) => { if (current) { setDetail(data); setQr(image) } })
      .catch((err) => { if (current) setError(errorText(err)) })
    return () => { current = false }
  }, [fetchDetail])

  const voidLabel = async () => {
    setVoiding(true)
    setError('')
    try {
      await trackingApi(`units/${unitId}/void`, { method: 'POST', body: { reason: voidReason } })
      setVoidReason('')
      await load()
    } catch (err) {
      setError(errorText(err))
    }
    setVoiding(false)
  }

  if (!detail) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>

  const { unit } = detail
  const active = unit.status === 'ACTIVE'
  const printed = detail.printJobs.some((job) => job.status === 'sent' || job.status === 'confirmed')
  const showPrint = active && (printed ? canReprintOrVoid : canPrint)

  return (
    <div className="space-y-6">
      {detail.warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
        </p>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-wrap gap-6 rounded-lg border border-gray-200 bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        {qr && <img src={qr} alt={`QR code for ${unit.stock_tracking_id}`} className="h-40 w-40" />}
        <div className="min-w-64 flex-1 space-y-3">
          <div>
            <h2 className="font-mono text-xl font-semibold text-gray-900">{unit.stock_tracking_id}</h2>
            <p className="text-sm text-gray-700">{unit.item_code} {unit.item_name} {unit.size_label}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-gray-500">Weight</dt><dd className="font-medium text-gray-900">{unit.quantity} {unit.unit}</dd></div>
            <div><dt className="text-gray-500">Weight basis</dt><dd className="text-gray-900">{WEIGHT_BASIS[unit.weight_basis]}</dd></div>
            <div><dt className="text-gray-500">Bundle</dt><dd className="text-gray-900">{unit.bundle_no} of {unit.bundle_count}</dd></div>
            <div><dt className="text-gray-500">Purchase line</dt><dd className="font-mono text-gray-900">{unit.purchase_line_id}</dd></div>
            <div><dt className="text-gray-500">Bill</dt><dd className="text-gray-900">{unit.bill_number}</dd></div>
            <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{unit.warehouse_name}</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className="text-gray-900">{active ? 'Active' : 'Voided'}</dd></div>
          </dl>
        </div>
      </section>

      {showPrint && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">{printed ? 'Reprint label' : 'Print label'}</h3>
          {printed && <p className="text-sm text-gray-600">A reprint uses the same QR code and tracking ID.</p>}
          <LabelPrintPanel units={[unit]} reprint={printed} onChanged={load} />
        </section>
      )}

      {active && canReprintOrVoid && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Void label</h3>
          <p className="text-sm text-gray-600">The label will scan as Do Not Use. This cannot be undone and does not change stock.</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason"
              className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={voiding || !voidReason.trim()}
              onClick={voidLabel}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Void label
            </button>
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
            {detail.events.map((event) => (
              <tr key={event.id}>
                <td className="whitespace-nowrap px-4 py-2 text-gray-600">{when(event.occurred_at)}</td>
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
