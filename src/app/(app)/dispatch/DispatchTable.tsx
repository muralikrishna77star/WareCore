'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { ReferenceLink } from '@/components/ReferenceLink'
import { ExportExcelButton } from '@/components/ExportExcelButton'

type Column = {
  key: string
  label: string
  align?: 'right'
  searchable?: boolean
  filterValue?: (o: any) => string
}

const columns: Column[] = [
  { key: 'date', label: 'Date', filterValue: (o) => formatDate(o.dispatch_date) },
  { key: 'invoice', label: 'Invoice Number', filterValue: (o) => o.invoice_number || '' },
  { key: 'company', label: 'Company', filterValue: (o) => o.companies?.code || '' },
  { key: 'customer', label: 'Customer', filterValue: (o) => o.customers?.name || '' },
  { key: 'sale_ref', label: 'Sale Ref ID', filterValue: (o) => o.sale_ref_id || '' },
  { key: 'vehicle', label: 'Vehicle', filterValue: (o) => o.vehicle_number || '' },
  { key: 'qty', label: 'Qty', align: 'right', searchable: false },
  { key: 'amount', label: 'Amount', align: 'right', searchable: false },
  { key: 'type', label: 'Type', filterValue: (o) => (o.is_vendor_direct ? 'From Vendor' : 'Warehouse') },
  { key: 'status', label: 'Status', filterValue: (o) => (o.status === 'cancelled' ? 'Cancelled' : o.status === 'draft' ? 'Draft' : 'Active') },
  { key: 'notes', label: 'Notes', filterValue: (o) => o.notes || '' },
  { key: 'actions', label: 'Actions', searchable: false },
]

export default function DispatchTable({
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
        if (!col?.filterValue) return true
        return col.filterValue(o).toLowerCase().includes(value.trim().toLowerCase())
      })
    )
  }, [orders, filters])

  const exportRows = filtered.map((o: any) => {
    const dispItems = o.dispatch_items ?? []
    const totalQty = dispItems.reduce((s: number, i: any) => s + Number(i.quantity), 0)
    const totalAmt = dispItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
    return {
      'Date': formatDate(o.dispatch_date),
      'Invoice Number': o.invoice_number || '',
      'Company': o.companies?.code || '',
      'Customer': o.customers?.name || '',
      'Sale Ref ID': o.sale_ref_id || '',
      'Vehicle': o.vehicle_number || '',
      'Qty': totalQty,
      'Amount': totalAmt,
      'Type': o.is_vendor_direct ? 'From Vendor' : 'Warehouse',
      'Status': o.status === 'cancelled' ? 'Cancelled' : o.status === 'draft' ? 'Draft' : 'Active',
      'Notes': o.notes || '',
    }
  })

  return (
    <>
      {filtered.length > 0 && (
        <div className="flex justify-end px-6 py-2 bg-white border-b">
          <ExportExcelButton
            rows={exportRows}
            filename={`sales_${fromDate ?? ''}_to_${toDate ?? ''}`}
            sheetName="Sales"
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
        </tr>
        <tr className="border-b bg-white">
          {columns.map((col) => (
            <th key={col.key} className="px-6 py-2">
              {col.searchable === false ? null : (
                <input
                  type="text"
                  value={filters[col.key] ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                  placeholder="Search..."
                  className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-normal normal-case text-gray-700 focus:border-blue-400 focus:outline-none"
                />
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {filtered.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-500">
              No sale entries match your search.
            </td>
          </tr>
        )}
        {filtered.map((o: any) => {
          const dispItems = o.dispatch_items ?? []
          const totalQty = dispItems.reduce((s: number, i: any) => s + Number(i.quantity), 0)
          const totalAmt = dispItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
          const cancelled = o.status === 'cancelled'

          return (
            <tr key={o.id} className={`hover:bg-gray-50 ${cancelled ? 'opacity-60' : ''}`}>
              <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(o.dispatch_date)}</td>
              <td className="px-6 py-3 font-mono text-xs text-gray-700">{o.invoice_number || '—'}</td>
              <td className="px-6 py-3">
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {o.companies?.code}
                </span>
              </td>
              <td className={`px-6 py-3 font-medium ${cancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                {o.customers?.name || '—'}
              </td>
              <td className="px-6 py-3 text-gray-500 font-mono text-xs">{o.sale_ref_id || '—'}</td>
              <td className="px-6 py-3 text-gray-600">{o.vehicle_number || '—'}</td>
              <td className="px-6 py-3 text-right font-medium text-gray-700">{totalQty.toFixed(3)}</td>
              <td className="px-6 py-3 text-right font-medium text-gray-700">
                {totalAmt > 0 ? `₹${totalAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
              </td>
              <td className="px-6 py-3">
                {o.is_vendor_direct ? (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                    From Vendor
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-500 border border-gray-200">
                    Warehouse
                  </span>
                )}
              </td>
              <td className="px-6 py-3">
                {cancelled ? (
                  <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 border border-red-200">
                    Cancelled
                  </span>
                ) : o.status === 'draft' ? (
                  <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 border border-yellow-200">
                    Draft
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                    Active
                  </span>
                )}
              </td>
              <td className="px-6 py-3 text-gray-600 max-w-xs truncate" title={o.notes || ''}>{o.notes || '—'}</td>
              <td className="px-6 py-3 flex gap-2">
                <ReferenceLink type="dispatch" id={o.id}>
                  View
                </ReferenceLink>
                {(o.status === 'draft' || o.status === 'active') && (
                  <Link href={`/dispatch/${o.id}/edit`} className="text-yellow-600 hover:text-yellow-800 text-xs font-medium">
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
