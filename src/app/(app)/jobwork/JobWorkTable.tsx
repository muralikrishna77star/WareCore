'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate, getJobWorkOrderStatusLabel } from '@/lib/utils'
import { ReferenceLink } from '@/components/ReferenceLink'
import { ExportExcelButton } from '@/components/ExportExcelButton'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  partial_return: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

type Column = {
  key: string
  label: string
  align?: 'left' | 'right'
  filterValue: (o: any) => string
}

const columns: Column[] = [
  { key: 'dispatch_date', label: 'Dispatch Date', filterValue: (o) => formatDate(o.dispatch_date) },
  { key: 'company', label: 'Company', filterValue: (o) => o.companies?.code || '' },
  { key: 'vendor', label: 'Vendor', filterValue: (o) => o.suppliers?.name || '' },
  {
    key: 'items',
    label: 'Items',
    filterValue: (o) => {
      const items = o.job_work_items ?? []
      return `${items.length} items`
    },
  },
  {
    key: 'expected_return',
    label: 'Expected Return',
    filterValue: (o) => (o.expected_return_date ? formatDate(o.expected_return_date) : ''),
  },
  { key: 'status', label: 'Status', filterValue: (o) => getJobWorkOrderStatusLabel(o.status) },
  { key: 'notes', label: 'Notes', filterValue: (o) => o.notes || '' },
]

export default function JobWorkTable({
  orders,
  fromDate,
  toDate,
}: {
  orders: any[]
  fromDate?: string
  toDate?: string
}) {
  const [filters, setFilters] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== '')
    if (active.length === 0) return orders
    return orders.filter((o) =>
      active.every(([key, value]) => {
        const col = columns.find((c) => c.key === key)
        if (!col) return true
        return col.filterValue(o).toLowerCase().includes(value.trim().toLowerCase())
      })
    )
  }, [orders, filters])

  const exportRows = filtered.map((o: any) => {
    const items = o.job_work_items ?? []
    return {
      'Dispatch Date': formatDate(o.dispatch_date),
      'Company': o.companies?.code || '',
      'Vendor': o.suppliers?.name || '',
      'Items': items.length,
      'Expected Return': o.expected_return_date ? formatDate(o.expected_return_date) : '',
      'Status': getJobWorkOrderStatusLabel(o.status),
      'Notes': o.notes || '',
    }
  })

  return (
    <>
      {filtered.length > 0 && (
        <div className="flex justify-end px-6 py-2 bg-white border-b">
          <ExportExcelButton
            rows={exportRows}
            filename={`job-work-orders_${fromDate ?? ''}_to_${toDate ?? ''}`}
            sheetName="Job Work"
          />
        </div>
      )}
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-gray-50">
        <tr className="text-left border-b">
          {columns.map((col) => (
            <th key={col.key} className={`px-6 py-3 text-xs font-medium text-gray-500 uppercase ${col.align === 'right' ? 'text-right' : ''}`}>
              {col.label}
            </th>
          ))}
          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
        </tr>
        <FilterInputs filters={filters} setFilters={setFilters} />
      </thead>
      <tbody className="divide-y divide-gray-100">
        {filtered.length === 0 && (
          <tr>
            <td colSpan={columns.length + 1} className="px-6 py-12 text-center text-gray-500">
              No job work orders match your search.
            </td>
          </tr>
        )}
        {filtered.map((o: any) => {
          const items = o.job_work_items ?? []
          const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity_sent), 0)
          const totalReturned = items.reduce((s: number, i: any) => s + Number(i.quantity_received || 0), 0)
          const totalTransferred = items.reduce((s: number, i: any) => s + Number(i.quantity_transferred_out || 0), 0)
          const isOverdue = o.expected_return_date && !o.actual_return_date && new Date(o.expected_return_date) < new Date()

          return (
            <tr key={o.id} className="hover:bg-gray-50">
              <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
              <td className="px-6 py-3">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {o.companies?.code}
                </span>
              </td>
              <td className="px-6 py-3 font-medium text-gray-900">{o.suppliers?.name || '—'}</td>
              <td className="px-6 py-3">
                <p className="text-gray-700">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-500">
                  {totalQty.toFixed(3)} dispatched · {totalReturned.toFixed(3)} returned
                  {totalTransferred > 0 && ` · ${totalTransferred.toFixed(3)} transferred`}
                </p>
              </td>
              <td className={`px-6 py-3 whitespace-nowrap ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                {o.expected_return_date ? formatDate(o.expected_return_date) : '—'}
                {isOverdue && <span className="ml-1 text-xs">⚠ Overdue</span>}
              </td>
              <td className="px-6 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[o.status] || 'bg-gray-100 text-gray-700'}`}>
                  {getJobWorkOrderStatusLabel(o.status)}
                </span>
              </td>
              <td className="px-6 py-3 text-gray-600 max-w-xs truncate" title={o.notes || ''}>{o.notes || '—'}</td>
              <td className="px-6 py-3 space-x-3 whitespace-nowrap">
                <ReferenceLink type="job_work" id={o.id}>
                  View
                </ReferenceLink>
                {o.status !== 'cancelled' && o.status !== 'completed' && (
                  <Link href={`/jobwork/${o.id}/edit`} className="text-amber-600 hover:text-amber-800 text-xs font-medium">
                    Edit
                  </Link>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </>
  )
}

function FilterInputs({
  filters,
  setFilters,
}: {
  filters: Record<string, string>
  setFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  return (
    <tr className="border-b bg-white">
      {columns.map((col) => (
        <th key={col.key} className="px-6 py-2">
          <input
            type="text"
            value={filters[col.key] ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
            placeholder="Search..."
            className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal normal-case text-gray-700 focus:border-blue-400 focus:outline-none"
          />
        </th>
      ))}
      <th className="px-6 py-2" />
    </tr>
  )
}
