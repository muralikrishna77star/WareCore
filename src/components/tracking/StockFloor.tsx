'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { TrackingUnit } from '@/lib/tracking/constants'
import { errorText, trackingApi } from './api'
import { ScanInput } from './ScanInput'
import { LifecycleBadge } from './StatusBadge'
import { UnitActions } from './UnitActions'

type Lookup =
  | { kind: 'found'; unit: TrackingUnit; warnings: string[] }
  | { kind: 'test' | 'invalid' | 'not_found' | 'other_company' }

const MESSAGES = {
  test: 'This is a printer test label. It is not a stock item.',
  invalid: 'This is not a bundle label.',
  not_found: 'No bundle has this code.',
  other_company: 'This label belongs to a company or warehouse you do not have access to.',
}

/** Scan a bundle, then put it away, move it or change its status. */
export function StockFloor({ canManage }: { canManage: boolean }) {
  const [unit, setUnit] = useState<TrackingUnit | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const scan = useCallback(async (code: string) => {
    setBusy(true)
    setMessage('')
    try {
      const result = await trackingApi<Lookup>('lookup', { method: 'POST', body: { code } })
      if (result.kind === 'found') {
        setUnit(result.unit)
        setWarnings(result.warnings)
      } else {
        setUnit(null)
        setWarnings([])
        setMessage(MESSAGES[result.kind])
      }
    } catch (err) {
      setMessage(errorText(err))
    }
    setBusy(false)
  }, [])

  const reload = useCallback(async () => {
    if (!unit) return
    const detail = await trackingApi<{ unit: TrackingUnit; warnings: string[] }>(`units/${unit.id}`)
    setUnit(detail.unit)
    setWarnings(detail.warnings)
  }, [unit])

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <ScanInput id="stock-bundle" label="Scan a bundle" placeholder="ST2611-000001" busy={busy} autoFocus onScan={scan} />
      </section>

      {message && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</p>}

      {unit && (
        <>
          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            {warnings.map((warning) => (
              <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
                <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
              </p>
            ))}
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/tracking/units/${unit.id}`} className="font-mono text-lg font-semibold text-blue-600 hover:underline">{unit.stock_tracking_id}</Link>
                <p className="text-sm text-gray-700">{unit.item_code} {unit.item_name} {unit.size_label}</p>
              </div>
              <p className="whitespace-nowrap text-lg font-semibold text-gray-900">{unit.quantity} {unit.unit}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-gray-500">Status</dt><dd className="mt-0.5"><LifecycleBadge status={unit.lifecycle_status} voided={unit.status === 'VOIDED'} /></dd></div>
              <div><dt className="text-gray-500">Location</dt><dd className="font-mono text-gray-900">{unit.location_code ?? 'None'}</dd></div>
              <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{unit.warehouse_name}</dd></div>
              {unit.status_reason && <div><dt className="text-gray-500">Reason</dt><dd className="text-gray-900">{unit.status_reason}</dd></div>}
            </dl>
          </section>
          <UnitActions key={unit.id} unit={unit} canOperate canManage={canManage} onChanged={reload} />
        </>
      )}
    </div>
  )
}
