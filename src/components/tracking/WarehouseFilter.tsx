'use client'

import { useEffect, useState } from 'react'
import type { SnapshotWarehouse } from '@/lib/tracking/offlineShared'
import { trackingApi } from './api'

/** Every tracking warehouse this person can see, or one of them. */
export function WarehouseFilter({ value, onChange }: { value: string; onChange: (warehouseId: string) => void }) {
  const [warehouses, setWarehouses] = useState<SnapshotWarehouse[]>([])

  useEffect(() => {
    let current = true
    trackingApi<{ warehouses: SnapshotWarehouse[] }>('warehouses')
      .then((data) => { if (current) setWarehouses(data.warehouses) })
      .catch(() => { /* The filter is optional; the page still shows every warehouse. */ })
    return () => { current = false }
  }, [])

  const companies = new Set(warehouses.map((w) => w.company_id)).size
  return (
    <select
      aria-label="Warehouse"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
    >
      <option value="">All tracking warehouses</option>
      {warehouses.map((w) => (
        <option key={w.id} value={w.id}>{companies > 1 ? `${w.company_name}: ${w.name}` : w.name}</option>
      ))}
    </select>
  )
}
