'use client'

import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

type TransferItem = {
  quantity: number | string
  size_label: string | null
  material_types: { description: string | null } | null
  material_sizes: { size_label: string | null } | null
}

export type TransferRow = {
  id: string
  transfer_date: string
  status: string | null
  notes?: string | null
  companies_from: { name: string; code?: string | null } | null
  companies_to: { name: string; code?: string | null } | null
  warehouses_from: { name: string } | null
  warehouses_to: { name: string } | null
  transfer_items: TransferItem[]
}

// Sorting reorders whole transfers (each transfer's item lines stay
// contiguous, since they share rowSpan-merged cells below) — a per-item
// column like "Material" sorts transfers by their first item line.
function sortValue(t: TransferRow, key: string): string | number {
  const first = t.transfer_items?.[0] ?? null
  switch (key) {
    case 'date': return t.transfer_date
    case 'from_company': return t.companies_from?.name ?? ''
    case 'from_warehouse': return t.warehouses_from?.name ?? ''
    case 'to_company': return t.companies_to?.name ?? ''
    case 'to_warehouse': return t.warehouses_to?.name ?? ''
    case 'material': return first?.material_types?.description ?? ''
    case 'size': return first?.material_sizes?.size_label ?? first?.size_label ?? ''
    case 'qty': return (t.transfer_items ?? []).reduce((s, i) => s + Number(i.quantity), 0)
    case 'status': return t.status ?? ''
    default: return ''
  }
}

export function TransfersReportRows({ transfers }: { transfers: TransferRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(transfers, {
    date: (t) => sortValue(t, 'date'),
    from_company: (t) => sortValue(t, 'from_company'),
    from_warehouse: (t) => sortValue(t, 'from_warehouse'),
    to_company: (t) => sortValue(t, 'to_company'),
    to_warehouse: (t) => sortValue(t, 'to_warehouse'),
    material: (t) => sortValue(t, 'material'),
    size: (t) => sortValue(t, 'size'),
    qty: (t) => sortValue(t, 'qty'),
    status: (t) => sortValue(t, 'status'),
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="From Company" sortKey="from_company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="From Warehouse" sortKey="from_warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="To Company" sortKey="to_company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="To Warehouse" sortKey="to_warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Qty (T)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((t) => {
          const items = t.transfer_items ?? []
          const rows: (TransferItem | null)[] = items.length === 0 ? [null] : items
          return rows.map((item, idx: number) => (
            <tr key={`${t.id}-${idx}`} className="hover:bg-gray-50">
              {idx === 0 && (
                <>
                  <td className="px-4 py-3 text-gray-600" rowSpan={rows.length}>{formatDate(t.transfer_date)}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{t.companies_from?.name}</td>
                  <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{t.warehouses_from?.name}</td>
                  <td className="px-4 py-3" rowSpan={rows.length}>{t.companies_to?.name}</td>
                  <td className="px-4 py-3 text-gray-500" rowSpan={rows.length}>{t.warehouses_to?.name}</td>
                </>
              )}
              {item ? (
                <>
                  <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
                  <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
                </>
              ) : (
                <td className="px-4 py-3 text-gray-400" colSpan={3}>No items</td>
              )}
              {idx === 0 && (
                <td className="px-4 py-3" rowSpan={rows.length}>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[t.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                    {t.status?.replace('_', ' ')}
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
