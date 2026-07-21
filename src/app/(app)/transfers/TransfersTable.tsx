'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { ReferenceLink } from '@/components/ReferenceLink'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { ItemComboBox, type ComboOption } from '@/components/ItemComboBox'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

type ItemOption = { id: string; item_code: string; item_name: string }

export default function TransfersTable({
  transfers,
  fromDate,
  toDate,
  basePath,
  itemOptions,
  itemValue,
  emptyMessage,
}: {
  transfers: any[]
  fromDate?: string
  toDate?: string
  basePath: string
  itemOptions: ItemOption[]
  itemValue: string
  emptyMessage?: string
}) {
  const router = useRouter()
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Item / Date range decide which transfers get fetched from the server at all,
  // so they're staged locally and only applied on demand — unlike From/To/Status,
  // which narrow the already-loaded rows instantly.
  const [pendingItem, setPendingItem] = useState(itemValue)
  const [pendingFrom, setPendingFrom] = useState(fromDate ?? '')
  const [pendingTo, setPendingTo] = useState(toDate ?? '')

  const dirty =
    pendingItem !== itemValue || pendingFrom !== (fromDate ?? '') || pendingTo !== (toDate ?? '')

  const applyServerFilters = () => {
    const qs = new URLSearchParams()
    if (pendingFrom) qs.set('from', pendingFrom)
    if (pendingTo) qs.set('to', pendingTo)
    if (pendingItem) qs.set('item', pendingItem)
    router.push(`${basePath}?${qs.toString()}`)
  }

  const clearAll = () => {
    setPendingItem('')
    router.push(basePath)
  }

  const itemCombo: ComboOption[] = useMemo(
    () =>
      itemOptions.map((i) => ({
        id: i.id,
        label: `${i.item_code} — ${i.item_name}`,
        search: `${i.item_code} ${i.item_name}`.toLowerCase(),
      })),
    [itemOptions]
  )
  const selectedItem = itemOptions.find((i) => i.id === itemValue)

  const filtered = useMemo(() => {
    return transfers.filter((t) => {
      if (fromFilter.trim()) {
        const from = `${t.from_company?.code || ''} ${t.from_warehouse?.name || ''}`.toLowerCase()
        if (!from.includes(fromFilter.trim().toLowerCase())) return false
      }
      if (toFilter.trim()) {
        const to = `${t.to_company?.code || ''} ${t.to_warehouse?.name || ''}`.toLowerCase()
        if (!to.includes(toFilter.trim().toLowerCase())) return false
      }
      if (statusFilter.trim()) {
        const status = (t.status?.replace('_', ' ') || '').toLowerCase()
        if (!status.includes(statusFilter.trim().toLowerCase())) return false
      }
      return true
    })
  }, [transfers, fromFilter, toFilter, statusFilter])

  const exportRows = filtered.map((t: any) => {
    const items = t.transfer_items ?? []
    const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity), 0)
    return {
      'Date': formatDate(t.transfer_date),
      'From': `${t.from_company?.code || ''} / ${t.from_warehouse?.name || ''}`,
      'To': `${t.to_company?.code || ''} / ${t.to_warehouse?.name || ''}`,
      'Items': items.length,
      'Qty': totalQty,
      'Status': t.status?.replace('_', ' ') ?? '',
    }
  })

  const hasAppliedFilters = !!itemValue

  return (
    <>
      {filtered.length > 0 && (
        <div className="flex justify-end px-6 py-2 bg-white border-b">
          <ExportExcelButton
            rows={exportRows}
            filename={`transfers_${fromDate ?? ''}_to_${toDate ?? ''}`}
            sheetName="Transfers"
          />
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50">
          <tr className="text-left border-b">
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">From</th>
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">To</th>
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Items</th>
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
          <tr className="border-b bg-white">
            <th className="px-6 py-2 align-top">
              <div className="flex flex-col gap-1">
                <input
                  type="date"
                  value={pendingFrom}
                  onChange={(e) => setPendingFrom(e.target.value)}
                  aria-label="Created from"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs font-normal text-gray-700 focus:border-blue-400 focus:outline-none"
                />
                <input
                  type="date"
                  value={pendingTo}
                  onChange={(e) => setPendingTo(e.target.value)}
                  aria-label="Created to"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs font-normal text-gray-700 focus:border-blue-400 focus:outline-none"
                />
              </div>
            </th>
            <th className="px-6 py-2 align-top">
              <input
                type="text"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
                placeholder="Search..."
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal text-gray-700 focus:border-blue-400 focus:outline-none"
              />
            </th>
            <th className="px-6 py-2 align-top">
              <input
                type="text"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
                placeholder="Search..."
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal text-gray-700 focus:border-blue-400 focus:outline-none"
              />
            </th>
            <th className="px-6 py-2 align-top">
              <ItemComboBox
                name="item"
                defaultValue={itemValue}
                defaultLabel={selectedItem ? `${selectedItem.item_code} — ${selectedItem.item_name}` : ''}
                placeholder="Search item…"
                options={itemCombo}
                onSelect={(opt) => setPendingItem(opt?.id ?? '')}
              />
            </th>
            <th className="px-6 py-2 align-top">
              <input
                type="text"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                placeholder="Search..."
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal text-gray-700 focus:border-blue-400 focus:outline-none"
              />
            </th>
            <th className="px-6 py-2 align-top">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={applyServerFilters}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${
                    dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  title="Apply Item / Date filters"
                >
                  Apply
                </button>
                {hasAppliedFilters && (
                  <button type="button" onClick={clearAll} className="text-xs text-gray-500 hover:underline">
                    Clear
                  </button>
                )}
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                {transfers.length === 0 ? (emptyMessage || 'No transfers in the selected range.') : 'No transfers match your search.'}
              </td>
            </tr>
          )}
          {filtered.map((t: any) => {
            const items = t.transfer_items ?? []
            const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity), 0)

            return (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(t.transfer_date)}</td>
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900">{t.from_company?.code || '—'}</p>
                  <p className="text-xs text-gray-500">{t.from_warehouse?.name || '—'}</p>
                </td>
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900">{t.to_company?.code || '—'}</p>
                  <p className="text-xs text-gray-500">{t.to_warehouse?.name || '—'}</p>
                </td>
                <td className="px-6 py-3">
                  <p className="text-gray-700">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-gray-500">{totalQty.toFixed(3)} tons</p>
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[t.status] || 'bg-gray-100 text-gray-700'}`}>
                    {t.status?.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <ReferenceLink type="transfer" id={t.id}>
                    View
                  </ReferenceLink>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
