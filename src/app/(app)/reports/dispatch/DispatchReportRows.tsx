'use client'

import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  dispatched: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

type DispatchItem = {
  quantity: number | string
  rate: number | string | null
  amount: number | string | null
  size_label: string | null
  material_types: { description: string | null } | null
  material_sizes: { size_label: string | null } | null
}

export type DispatchOrderRow = {
  id: string
  dispatch_date: string
  vehicle_number: string | null
  invoice_number: string | null
  status?: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  customers: { name: string } | null
  dispatch_items: DispatchItem[]
}

function sortValue(o: DispatchOrderRow, key: string): string | number {
  const first = o.dispatch_items?.[0] ?? null
  switch (key) {
    case 'date': return o.dispatch_date
    case 'invoice': return o.invoice_number ?? ''
    case 'company': return o.companies?.name ?? ''
    case 'warehouse': return o.warehouses?.name ?? ''
    case 'customer': return o.customers?.name ?? ''
    case 'vehicle': return o.vehicle_number ?? ''
    case 'material': return first?.material_types?.description ?? ''
    case 'size': return first?.material_sizes?.size_label ?? first?.size_label ?? ''
    case 'qty': return first ? Number(first.quantity) : 0
    case 'rate': return first?.rate ? Number(first.rate) : 0
    case 'amount': return first?.amount ? Number(first.amount) : 0
    case 'status': return o.status ?? ''
    default: return ''
  }
}

export function DispatchReportRows({ orders }: { orders: DispatchOrderRow[] }) {
  const keys = ['date', 'invoice', 'company', 'warehouse', 'customer', 'vehicle', 'material', 'size', 'qty', 'rate', 'amount', 'status']
  const accessors = Object.fromEntries(keys.map((k) => [k, (o: DispatchOrderRow) => sortValue(o, k)]))
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(orders, accessors)

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Invoice No." sortKey="invoice" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Customer" sortKey="customer" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Vehicle" sortKey="vehicle" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Qty (T)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Rate" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Amount (₹)" sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((o) => {
          const items = o.dispatch_items ?? []
          const rows: (DispatchItem | null)[] = items.length === 0 ? [null] : items
          return rows.map((item, idx: number) => (
            <tr key={`${o.id}-${idx}`} className="hover:bg-gray-50">
              {idx === 0 && (
                <>
                  <td className="px-4 py-3 text-gray-600" rowSpan={rows.length}>{formatDate(o.dispatch_date)}</td>
                  <td className="px-4 py-3 font-medium text-orange-700" rowSpan={rows.length}>{o.invoice_number ?? '—'}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{o.companies?.name}</td>
                  <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{o.warehouses?.name}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{o.customers?.name}</td>
                  <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{o.vehicle_number ?? '—'}</td>
                </>
              )}
              {item ? (
                <>
                  <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
                  <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
                  <td className="px-4 py-3 text-right">{item.rate ? `₹${Number(item.rate).toLocaleString('en-IN')}` : '—'}</td>
                  <td className="px-4 py-3 text-right">{item.amount ? `₹${Number(item.amount).toLocaleString('en-IN')}` : '—'}</td>
                </>
              ) : (
                <td className="px-4 py-3 text-gray-400" colSpan={5}>No items</td>
              )}
              {idx === 0 && (
                <td className="px-4 py-3" rowSpan={rows.length}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[o.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                    {o.status?.replace(/_/g, ' ')}
                  </span>
                </td>
              )}
            </tr>
          ))
        })}
      </tbody>
    </>
  )
}
