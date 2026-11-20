'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LIFECYCLE_LABELS, type TrackingUnit } from '@/lib/tracking/constants'
import { errorText, trackingApi } from './api'
import { LifecycleBadge } from './StatusBadge'

export function TrackedUnits({ initialStatus = '' }: { initialStatus?: string }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [units, setUnits] = useState<TrackingUnit[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const filter = status === 'VOIDED' ? 'status=VOIDED' : `lifecycle=${status}`
    const timer = setTimeout(() => {
      trackingApi<{ units: TrackingUnit[] }>(`units?search=${encodeURIComponent(search)}&${filter}`)
        .then((data) => { setUnits(data.units); setError('') })
        .catch((err) => setError(errorText(err)))
    }, 250)
    return () => clearTimeout(timer)
  }, [search, status])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tracking ID, line, bill or item"
          className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">All labels</option>
          {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="VOIDED">Voided</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {units === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {units?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No tracked units found.</p>}
      {!!units?.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Tracking ID</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3">Bundle</th>
                <th className="px-4 py-3">Purchase line</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.map((unit) => (
                <tr key={unit.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    <Link href={`/tracking/units/${unit.id}`} className="text-blue-600 hover:underline">{unit.stock_tracking_id}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{unit.item_code} {unit.item_name} {unit.size_label}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">{unit.quantity} {unit.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{unit.bundle_no} of {unit.bundle_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-700">{unit.purchase_line_id}</td>
                  <td className="px-4 py-3 text-gray-700">{unit.warehouse_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-700">{unit.location_code}</td>
                  <td className="px-4 py-3"><LifecycleBadge status={unit.lifecycle_status} voided={unit.status === 'VOIDED'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
