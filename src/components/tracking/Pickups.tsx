'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PICKUP_STATUS_LABELS, type PickupSummary } from '@/lib/tracking/constants'
import { errorText, formatWhen, trackingApi } from './api'
import { PickupBadge } from './StatusBadge'

interface Options {
  customers: { id: string; name: string }[]
  warehouses: { id: string; name: string; company_id: string; company_name: string }[]
}

const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'

export function Pickups({ canCreate }: { canCreate: boolean }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [pickups, setPickups] = useState<PickupSummary[] | null>(null)
  const [options, setOptions] = useState<Options>({ customers: [], warehouses: [] })
  const [error, setError] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      trackingApi<{ pickups: PickupSummary[] } & Options>(`pickups?search=${encodeURIComponent(search)}&status=${status}`)
        .then((data) => {
          setPickups(data.pickups)
          setOptions({ customers: data.customers, warehouses: data.warehouses })
          setError('')
        })
        .catch((err) => setError(errorText(err)))
    }, 250)
    return () => clearTimeout(timer)
  }, [search, status])

  const create = async () => {
    const warehouse = options.warehouses.find((w) => w.id === warehouseId)
    if (!warehouse) return
    setSaving(true)
    setError('')
    try {
      const { pickup } = await trackingApi<{ pickup: PickupSummary }>('pickups', {
        method: 'POST',
        body: { company_id: warehouse.company_id, warehouse_id: warehouse.id, customer_id: customerId },
      })
      router.push(`/tracking/pickups/${pickup.id}`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {canCreate && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Start a pickup</h2>
          <p className="text-sm text-gray-600">The sale can be linked now or after it has been entered.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Warehouse</span>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={field}>
                <option value="">Choose</option>
                {options.warehouses.map((w) => <option key={w.id} value={w.id}>{w.company_name} · {w.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-gray-700"><span className="mb-1 block font-medium">Customer</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={field}>
                <option value="">Choose</option>
                {options.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" disabled={saving || !warehouseId || !customerId} onClick={create} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Starting…' : 'Start pickup'}
          </button>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pickup, customer, invoice or vehicle" className="min-w-64 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">All pickups</option>
          {Object.entries(PICKUP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {pickups === null && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {pickups?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">No pickups found.</p>}
      {!!pickups?.length && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Pickup</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Bundles</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3">Sale</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pickups.map((pickup) => (
                <tr key={pickup.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono"><Link href={`/tracking/pickups/${pickup.id}`} className="text-blue-600 hover:underline">{pickup.pickup_no}</Link></td>
                  <td className="px-4 py-3 text-gray-700">{pickup.customer_name}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{pickup.bundle_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-900">{pickup.total_quantity} {pickup.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{pickup.invoice_number ?? 'Not linked'}</td>
                  <td className="px-4 py-3 text-gray-700">{pickup.warehouse_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(pickup.created_at)}</td>
                  <td className="px-4 py-3"><PickupBadge status={pickup.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
