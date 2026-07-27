'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

type JobWorkItem = {
  id: string
  item_name: string | null
  material_type_id: string
  size_label: string | null
  quantity_sent: number | string
  quantity_received: number | string | null
  quantity_transferred_out: number | string | null
  unit: string
  item_master_id: string | null
  material_types?: { description: string | null } | null
}

type JobWorkOrder = {
  id: string
  reference_number: string | null
  dispatch_date: string
  status: string
  vendor_id: string
  suppliers?: { name: string } | null
  companies?: { name: string } | null
  job_work_items: JobWorkItem[]
}

type VendorOption = { id: string; name: string }
type ItemOption = { id: string; item_code: string; item_name: string }

function pendingQty(item: JobWorkItem) {
  return Number(item.quantity_sent) - Number(item.quantity_received ?? 0) - Number(item.quantity_transferred_out ?? 0)
}

export default function VendorDirectSaleBrowseTable({
  orders,
  vendors,
  itemOptions,
}: {
  orders: JobWorkOrder[]
  vendors: VendorOption[]
  itemOptions: ItemOption[]
}) {
  const [vendorId, setVendorId] = useState('')
  const [itemId, setItemId] = useState('')
  const [jobWorkId, setJobWorkId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  // Bumped on Clear to force the (uncontrolled) combo boxes to remount and
  // drop their own typed-in search text along with the filter state.
  const [resetKey, setResetKey] = useState(0)

  const vendorCombo: ComboOption[] = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name, search: v.name.toLowerCase() })),
    [vendors]
  )
  const itemCombo: ComboOption[] = useMemo(
    () =>
      itemOptions.map((i) => ({
        id: i.id,
        label: `${i.item_code} — ${i.item_name}`,
        search: `${i.item_code} ${i.item_name}`.toLowerCase(),
      })),
    [itemOptions]
  )
  const jobWorkCombo: ComboOption[] = useMemo(
    () =>
      orders.map((o) => ({
        id: o.id,
        label: `${o.reference_number ?? o.id.slice(0, 8)} — ${o.suppliers?.name ?? ''}`,
        search: `${o.reference_number ?? ''} ${o.suppliers?.name ?? ''}`.toLowerCase(),
      })),
    [orders]
  )

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (vendorId && o.vendor_id !== vendorId) return false
      if (jobWorkId && o.id !== jobWorkId) return false
      if (itemId && !o.job_work_items.some((i) => i.item_master_id === itemId)) return false
      if (fromDate && o.dispatch_date < fromDate) return false
      if (toDate && o.dispatch_date > toDate) return false
      return true
    })
  }, [orders, vendorId, itemId, jobWorkId, fromDate, toDate])

  const hasFilters = !!(vendorId || itemId || jobWorkId || fromDate || toDate)
  const clearAll = () => {
    setVendorId('')
    setItemId('')
    setJobWorkId('')
    setFromDate('')
    setToDate('')
    setResetKey((k) => k + 1)
  }

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="grid grid-cols-2 gap-3 border-b bg-gray-50 px-6 py-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
          <ItemComboBox
            key={`vendor-${resetKey}`}
            name="vendor"
            placeholder="Search vendor…"
            options={vendorCombo}
            onSelect={(opt) => setVendorId(opt?.id ?? '')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
          <ItemComboBox
            key={`item-${resetKey}`}
            name="item"
            placeholder="Search item…"
            options={itemCombo}
            onSelect={(opt) => setItemId(opt?.id ?? '')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Job Work</label>
          <ItemComboBox
            key={`jobwork-${resetKey}`}
            name="jobwork"
            placeholder="Search job work…"
            options={jobWorkCombo}
            onSelect={(opt) => setJobWorkId(opt?.id ?? '')}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
          <div className="flex gap-1">
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="block w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            {hasFilters && (
              <button
                type="button"
                onClick={clearAll}
                className="whitespace-nowrap rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-auto max-h-[65vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr className="text-left border-b">
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Job Work</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Vendor</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Company</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Dispatch Date</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Pending Items</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  {orders.length === 0
                    ? 'No job work orders with pending stock at a vendor.'
                    : 'No job work orders match your search.'}
                </td>
              </tr>
            )}
            {filtered.map((o) => {
              const pendingItems = o.job_work_items.filter((i) => pendingQty(i) > 0.0005)
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <Link href={`/jobwork/${o.id}`} className="font-medium text-blue-600 hover:underline">
                      {o.reference_number ?? o.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-gray-900">{o.suppliers?.name ?? '—'}</td>
                  <td className="px-6 py-3 text-gray-600">{o.companies?.name ?? '—'}</td>
                  <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
                  <td className="px-6 py-3">
                    {pendingItems.map((i) => (
                      <p key={i.id} className="text-xs text-gray-700">
                        {i.item_name || i.material_types?.description || '—'}
                        {i.size_label ? ` (${i.size_label})` : ''}: <strong>{pendingQty(i).toFixed(3)} {i.unit}</strong>
                      </p>
                    ))}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <Link
                      href={`/dispatch/vendor-direct/new?jw=${o.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
                    >
                      Sell from Vendor
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
