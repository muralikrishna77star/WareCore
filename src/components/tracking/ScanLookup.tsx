'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { TrackingUnit } from '@/lib/tracking/constants'
import { errorText, trackingApi } from './api'
import { ScanInput } from './ScanInput'
import { LifecycleBadge } from './StatusBadge'

type Lookup =
  | { kind: 'found'; unit: TrackingUnit; warnings: string[]; printCount: number }
  | { kind: 'test' | 'invalid' | 'not_found' | 'other_company' }

const MESSAGES = {
  test: 'This is a printer test label. It is not a stock item.',
  invalid: 'This is not a WareCore tracking label.',
  not_found: 'No tracked unit has this code.',
  other_company: 'This label belongs to a company or warehouse you do not have access to.',
}

export function ScanLookup() {
  const [result, setResult] = useState<Lookup | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lookup = useCallback(async (value: string) => {
    setBusy(true)
    setError('')
    try {
      setResult(await trackingApi<Lookup>('lookup', { method: 'POST', body: { code: value } }))
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }, [])

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <ScanInput id="tracking-code" label="Scan a label or type its tracking ID" placeholder="ST2611-000001" busy={busy} autoFocus onScan={lookup} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {result && result.kind !== 'found' && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{MESSAGES[result.kind]}</p>
      )}

      {result?.kind === 'found' && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          {result.warnings.map((warning) => (
            <p key={warning} className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              <TriangleAlert className="h-4 w-4 shrink-0" /> {warning}
            </p>
          ))}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-mono text-lg font-semibold text-gray-900">{result.unit.stock_tracking_id}</h2>
              <p className="text-sm text-gray-700">{result.unit.item_code} {result.unit.item_name} {result.unit.size_label}</p>
            </div>
            <p className="whitespace-nowrap text-lg font-semibold text-gray-900">{result.unit.quantity} {result.unit.unit}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-gray-500">Status</dt><dd className="mt-0.5"><LifecycleBadge status={result.unit.lifecycle_status} voided={result.unit.status === 'VOIDED'} /></dd></div>
            <div><dt className="text-gray-500">Location</dt><dd className="font-mono text-gray-900">{result.unit.location_code ?? 'None'}</dd></div>
            <div><dt className="text-gray-500">Bundle</dt><dd className="text-gray-900">{result.unit.bundle_no} of {result.unit.bundle_count}{result.unit.part_no ? `, part ${result.unit.part_no}` : ''}</dd></div>
            <div><dt className="text-gray-500">Purchase line</dt><dd className="font-mono text-gray-900">{result.unit.purchase_line_id}</dd></div>
            <div><dt className="text-gray-500">Bill</dt><dd className="text-gray-900">{result.unit.bill_number}</dd></div>
            <div><dt className="text-gray-500">Warehouse</dt><dd className="text-gray-900">{result.unit.warehouse_name}</dd></div>
            <div><dt className="text-gray-500">Labels printed</dt><dd className="text-gray-900">{result.printCount}</dd></div>
          </dl>
          <Link href={`/tracking/units/${result.unit.id}`} className="inline-block text-sm font-medium text-blue-600 hover:underline">View full history</Link>
        </section>
      )}
    </div>
  )
}
