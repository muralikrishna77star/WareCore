'use client'

import { useState } from 'react'
import type { LifecycleStatus, TrackingUnit } from '@/lib/tracking/constants'
import { splitEqually, sumWeights, toThousandths } from '@/lib/tracking/bundles'
import { errorText, trackingApi } from './api'
import { LabelPrintPanel } from './LabelPrintPanel'
import { ScanInput } from './ScanInput'
import { useGpsCapture } from './useGpsCapture'

interface StatusAction {
  to: LifecycleStatus
  label: string
  reason?: boolean
  location?: boolean
}

const STATUS_ACTIONS: Partial<Record<LifecycleStatus, StatusAction[]>> = {
  IN_STOCK: [
    { to: 'ON_HOLD', label: 'Put on hold', reason: true },
    { to: 'MISSING', label: 'Mark missing', reason: true },
    { to: 'LEFT_WAREHOUSE', label: 'Mark left warehouse', reason: true },
  ],
  ON_HOLD: [{ to: 'IN_STOCK', label: 'Release from hold' }],
  MISSING: [{ to: 'IN_STOCK', label: 'Mark found', location: true }],
  LEFT_WAREHOUSE: [{ to: 'IN_STOCK', label: 'Bring back in', location: true }],
  PICKED_UP: [{ to: 'IN_STOCK', label: 'Customer return', reason: true, location: true }],
}

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'

/** Everything that can be done to one bundle on the warehouse floor. */
export function UnitActions({ unit, canOperate, canManage, onChanged }: {
  unit: TrackingUnit
  canOperate: boolean
  canManage: boolean
  onChanged: () => void | Promise<void>
}) {
  const capturePosition = useGpsCapture()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState<StatusAction | null>(null)
  const [reason, setReason] = useState('')
  const [location, setLocation] = useState('')
  const [partCount, setPartCount] = useState('')
  const [parts, setParts] = useState<{ quantity: string; weight_basis: 'weighed' | 'estimated' }[]>([])
  const [splitReason, setSplitReason] = useState('')
  const [newParts, setNewParts] = useState<TrackingUnit[] | null>(null)

  if (unit.status !== 'ACTIVE') return null

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setNotice(await work())
      setAction(null)
      setReason('')
      setLocation('')
      await onChanged()
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  const place = (code: string) => run(async () => {
    const position = await capturePosition(unit.company_id)
    const { unit: placed } = await trackingApi<{ unit: TrackingUnit }>(`units/${unit.id}/place`, { method: 'POST', body: { location: code, position } })
    return `Now at ${placed.location_code}`
  })

  const applyStatus = () => run(async () => {
    if (!action) return ''
    const position = await capturePosition(unit.company_id)
    await trackingApi(`units/${unit.id}/status`, { method: 'POST', body: { to: action.to, reason, location, position } })
    return 'Status updated'
  })

  const changePartCount = (value: string) => {
    setPartCount(value)
    const number = Number(value)
    setParts(Number.isInteger(number) && number >= 2 && number <= 20
      ? splitEqually(unit.quantity, number).map((quantity) => ({ quantity, weight_basis: 'estimated' as const }))
      : [])
  }

  const changePart = (index: number, quantity: string) => {
    setParts((rows) => rows.map((row, i) => (i === index ? { quantity, weight_basis: 'weighed' } : row)))
  }

  const partsTotal = parts.length ? sumWeights(parts.map((row) => row.quantity)) : null
  const partsMatch = partsTotal !== null && toThousandths(partsTotal) === toThousandths(unit.quantity)

  const split = () => run(async () => {
    const { units } = await trackingApi<{ units: TrackingUnit[] }>(`units/${unit.id}/split`, { method: 'POST', body: { parts, reason: splitReason } })
    setNewParts(units)
    setParts([])
    setPartCount('')
    setSplitReason('')
    return `Split into ${units.length} parts. Print their labels now.`
  })

  const canPlace = canOperate && ['LABELLED', 'IN_STOCK', 'ON_HOLD'].includes(unit.lifecycle_status)
  const statusActions = canManage ? STATUS_ACTIONS[unit.lifecycle_status] ?? [] : []
  const canSplit = canManage && ['IN_STOCK', 'ON_PICKUP'].includes(unit.lifecycle_status)
  const needsReason = !!action?.reason && !reason.trim()
  const needsLocation = !!action?.location && !location.trim()

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      {newParts && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">New part labels</h3>
          <LabelPrintPanel units={newParts} />
        </section>
      )}

      {canPlace && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <ScanInput
            id={`place-${unit.id}`}
            label={unit.lifecycle_status === 'LABELLED' ? 'Put away: scan the location' : 'Move: scan the new location'}
            placeholder="A-03-2"
            buttonLabel={unit.lifecycle_status === 'LABELLED' ? 'Put away' : 'Move'}
            busy={busy}
            onScan={place}
          />
        </section>
      )}

      {statusActions.length > 0 && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Change status</h3>
          <div className="flex flex-wrap gap-2">
            {statusActions.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setAction(item); setReason(''); setLocation(''); setError('') }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${action?.label === item.label ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {action && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              {action.reason && (
                <label className="block text-sm text-gray-700">
                  <span className="mb-1 block font-medium">Reason</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
                </label>
              )}
              {action.location && (
                <label className="block text-sm text-gray-700">
                  <span className="mb-1 block font-medium">Location</span>
                  <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Scan or type the location" className={`${field} font-mono`} />
                </label>
              )}
              <button
                type="button"
                disabled={busy || needsReason || needsLocation}
                onClick={applyStatus}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {action.label}
              </button>
            </div>
          )}
        </section>
      )}

      {canSplit && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="font-semibold text-gray-900">Split bundle</h3>
          <p className="text-sm text-gray-600">Use this when a customer takes part of a bundle. Each part gets a new label, and this label stops being valid.</p>
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block font-medium">Number of parts</span>
            <input inputMode="numeric" value={partCount} onChange={(e) => changePartCount(e.target.value)} placeholder="2 to 20" className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          {parts.length > 0 && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {parts.map((row, index) => (
                  <label key={index} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-14 shrink-0">Part {index + 1}</span>
                    <input inputMode="decimal" value={row.quantity} onChange={(e) => changePart(index, e.target.value)} className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right font-mono text-sm" />
                    <span className="text-xs text-gray-500">{row.weight_basis === 'estimated' ? 'Estimated' : 'Weighed'}</span>
                  </label>
                ))}
              </div>
              <p className={`text-sm font-medium ${partsMatch ? 'text-green-700' : 'text-red-600'}`}>Total {partsTotal ?? 'not valid'} of {unit.quantity} {unit.unit}</p>
              <label className="block text-sm text-gray-700">
                <span className="mb-1 block font-medium">Reason</span>
                <input value={splitReason} onChange={(e) => setSplitReason(e.target.value)} placeholder="For example, customer needs 2 MT" className={field} />
              </label>
              <button type="button" disabled={busy || !partsMatch || !splitReason.trim()} onClick={split} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                Split bundle
              </button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
