'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { TriangleAlert } from 'lucide-react'
import type { LineageNode, TrackingUnit, UnitOrigin, VendorMove } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'
import { LifecycleBadge } from './StatusBadge'
import { UnitActions } from './UnitActions'

interface Genealogy {
  madeFrom: LineageNode[]
  became: LineageNode[]
  origins: UnitOrigin[]
  moves: VendorMove[]
  dispatches: { id: string; dispatch_no: string; vendor_name: string; status: string; sent_at: string | null; job_work_reference: string | null; closed_reason: string | null }[]
}

interface Detail {
  unit: TrackingUnit
  parts: TrackingUnit[]
  genealogy: Genealogy
  warnings: string[]
  events: { id: string; event_type: string; occurred_at: string; actor_name: string | null }[]
  printJobs: { id: string; job_type: string; status: string; reason: string | null; created_at: string; printer_name: string | null; requested_by_name: string | null }[]
}

const RELATION_WORDS: Record<LineageNode['relation'], string> = {
  MADE_FROM: 'Output',
  REMAINDER_OF: 'Remainder',
  SPLIT_PART: 'Split part',
}

const SOURCE_WORDS: Partial<Record<TrackingUnit['source_type'], string>> = {
  VERIFIED_EXISTING: 'Verified old stock',
  SPLIT_PART: 'Part of a split bundle',
  JOB_WORK_OUTPUT: 'Job work output',
  JOB_WORK_REMAINDER: 'Unprocessed remainder from job work',
}

/** One side of a bundle's family tree: each step is indented by how far it is from this bundle. */
function LineageList({ nodes, empty }: { nodes: LineageNode[]; empty: string }) {
  if (nodes.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.unit_id} className="flex flex-wrap items-center gap-2 text-sm" style={{ paddingLeft: `${(node.depth - 1) * 16}px` }}>
          <Link href={`/tracking/units/${node.unit_id}`} className="font-mono text-blue-600 hover:underline">{node.stock_tracking_id}</Link>
          <span className="text-gray-700">{node.item_code} {node.size_label}</span>
          <span className="font-medium text-gray-900">{node.quantity} {node.unit}</span>
          <LifecycleBadge status={node.lifecycle_status} voided={node.status === 'VOIDED'} />
          {node.place && <span className="text-xs text-gray-500">{node.place}</span>}
        </li>
      ))}
    </ul>
  )
}

const EVENT_LABELS: Record<string, string> = {
  UNIT_CREATED: 'Label created',
  LABEL_PRINT_SENT: 'Sent to printer',
  LABEL_PRINT_CONFIRMED: 'Print confirmed',
  LABEL_PRINT_FAILED: 'Print failed',
  SCAN_LOOKUP: 'Scanned',
  UNIT_VOIDED: 'Label voided',
  PUT_AWAY: 'Put away',
  MOVED: 'Moved',
  STATUS_CHANGED: 'Status changed',
  UNIT_SPLIT: 'Bundle split',
  ADDED_TO_PICKUP: 'Added to pickup',
  REMOVED_FROM_PICKUP: 'Removed from pickup',
  MARKED_READY: 'Marked ready',
  PICKED_UP: 'Picked up',
  CUSTOMER_RETURN: 'Customer return',
  STOCK_VERIFIED: 'Old stock verified',
  ADDED_TO_DISPATCH: 'Scanned onto a vendor dispatch',
  REMOVED_FROM_DISPATCH: 'Removed from a vendor dispatch',
  SENT_TO_VENDOR: 'Sent to vendor',
  RETURNED_FROM_VENDOR: 'Back from vendor, unprocessed',
  VENDOR_CHANGED: 'Moved to another vendor',
  PROCESSED: 'Used up in job work',
}

const WEIGHT_BASIS: Record<string, string> = { whole_line: 'Whole purchase line', weighed: 'Weighed', estimated: 'Estimated' }

export function UnitDetail({ unitId, canPrint, canReprintOrVoid, canOperate, canManage }: {
  unitId: string
  canPrint: boolean
  canReprintOrVoid: boolean
  canOperate: boolean
  canManage: boolean
}) {
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
  const showPrint = active && !['SPLIT', 'PROCESSED'].includes(unit.lifecycle_status) && (printed ? canReprintOrVoid : canPrint)
  const { genealogy } = detail
  const hasFamily = genealogy.madeFrom.length > 0 || genealogy.became.length > 0 || genealogy.origins.length > 1
  const canVoid = active && canReprintOrVoid && ['LABELLED', 'IN_STOCK', 'ON_HOLD', 'MISSING'].includes(unit.lifecycle_status)

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
            <div><dt className="text-gray-500">Bundle</dt><dd className="text-gray-900">{unit.bundle_no} of {unit.bundle_count}{unit.part_no ? `, part ${unit.part_no}` : ''}</dd></div>
            <div><dt className="text-gray-500">Purchase line</dt><dd className="font-mono text-gray-900">{unit.purchase_line_id ?? `${genealogy.origins.length} lines, listed below`}</dd></div>
            {unit.bill_number && <div><dt className="text-gray-500">Bill</dt><dd className="text-gray-900">{unit.bill_number}</dd></div>}
            <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{unit.warehouse_name}</dd></div>
            <div><dt className="text-gray-500">Status</dt><dd className="mt-0.5"><LifecycleBadge status={unit.lifecycle_status} voided={!active} /></dd></div>
            {unit.current_vendor_name ? (
              <div>
                <dt className="text-gray-500">At vendor</dt>
                <dd className="font-medium text-gray-900">{unit.current_vendor_name}{unit.at_vendor_since && <span className="block text-xs font-normal text-gray-500">since {formatWhen(unit.at_vendor_since)}</span>}</dd>
              </div>
            ) : (
              <div><dt className="text-gray-500">Location</dt><dd className="font-mono text-gray-900">{unit.location_code ?? 'None'}</dd></div>
            )}
            {unit.status_reason && <div><dt className="text-gray-500">Reason</dt><dd className="text-gray-900">{unit.status_reason}</dd></div>}
            {SOURCE_WORDS[unit.source_type] && (
              <div>
                <dt className="text-gray-500">Source</dt>
                <dd className="text-gray-900">
                  {SOURCE_WORDS[unit.source_type]}
                  {unit.receipt_no && unit.output_receipt_id && <> on <Link href={`/tracking/outputs/${unit.output_receipt_id}`} className="font-mono text-blue-600 hover:underline">{unit.receipt_no}</Link></>}
                </dd>
              </div>
            )}
            {unit.parent_unit_id && <div><dt className="text-gray-500">Split from</dt><dd><Link href={`/tracking/units/${unit.parent_unit_id}`} className="text-blue-600 hover:underline">Original bundle</Link></dd></div>}
          </dl>
        </div>
      </section>

      {detail.parts.length > 0 && (
        <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Parts of this bundle</h3>
          <ul className="divide-y divide-gray-100">
            {detail.parts.map((part) => (
              <li key={part.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/tracking/units/${part.id}`} className="font-mono text-blue-600 hover:underline">{part.stock_tracking_id}</Link>
                <span className="text-gray-800">{part.quantity} {part.unit}</span>
                <LifecycleBadge status={part.lifecycle_status} voided={part.status === 'VOIDED'} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasFamily && (
        <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">Made from</h3>
            <LineageList nodes={genealogy.madeFrom} empty="Labelled straight from its purchase line." />
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">Became</h3>
            <LineageList nodes={genealogy.became} empty="Nothing has been made from this bundle." />
            {genealogy.became.length > 0 && (
              <p className="text-xs text-gray-500">{[...new Set(genealogy.became.map((n) => RELATION_WORDS[n.relation]))].join(', ')}</p>
            )}
          </div>
          {genealogy.origins.length > 1 && (
            <div className="space-y-1 md:col-span-2">
              <h3 className="font-semibold text-gray-900">Purchase lines</h3>
              <p className="text-xs text-gray-500">The weight sent from each line in the bundles this was made from. It is the input weight, not a share of this bundle.</p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {genealogy.origins.map((origin) => (
                  <li key={origin.purchase_line_id} className="rounded border border-gray-200 px-2 py-1">
                    <span className="font-mono text-gray-900">{origin.purchase_line_id}</span> <span className="text-gray-600">{origin.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(genealogy.dispatches.length > 0 || genealogy.moves.length > 0) && (
        <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Job work</h3>
          <ul className="space-y-1 text-sm">
            {genealogy.dispatches.map((d) => (
              <li key={d.id} className="text-gray-700">
                <Link href={`/tracking/dispatches/${d.id}`} className="font-mono text-blue-600 hover:underline">{d.dispatch_no}</Link>
                {' '}to {d.vendor_name}{d.sent_at ? `, sent ${formatWhen(d.sent_at)}` : ', not sent yet'}
                {d.job_work_reference ? ` · order ${d.job_work_reference}` : ''}
                {d.closed_reason ? ` · ${d.closed_reason}` : ''}
              </li>
            ))}
            {genealogy.moves.map((m) => (
              <li key={m.id} className="text-gray-700">
                Moved from {m.from_vendor_name} to {m.to_vendor_name} on {m.moved_on}{m.transfer_number ? ` · transfer ${m.transfer_number}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      <UnitActions unit={unit} canOperate={canOperate} canManage={canManage} onChanged={load} />

      {showPrint && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">{printed ? 'Reprint label' : 'Print label'}</h3>
          {printed && <p className="text-sm text-gray-600">A reprint uses the same QR code and tracking ID.</p>}
          <LabelPrintPanel units={[unit]} reprint={printed} onChanged={load} />
        </section>
      )}

      {canVoid && (
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
