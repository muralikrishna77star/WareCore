'use client'

import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

export type InventoryStockRow = {
  warehouse_name: string
  material_type_name: string
  unit: string
  size_label: string | null
  current_stock: number
}

export function InventoryCompanyRows({ rows: allRows }: { rows: InventoryStockRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(allRows, {
    warehouse: (r) => r.warehouse_name,
    material: (r) => r.material_type_name,
    size: (r) => r.size_label ?? '',
    stock: (r) => Number(r.current_stock),
    unit: (r) => r.unit,
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b text-left bg-gray-50">
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Stock" sortKey="stock" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
          <SortableTh label="Unit" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {sortedRows.map((row, i) => (
          <tr key={i} className="hover:bg-gray-50">
            <td className="px-6 py-3 text-gray-700">{row.warehouse_name}</td>
            <td className="px-6 py-3 font-medium text-gray-900">{row.material_type_name}</td>
            <td className="px-6 py-3 text-gray-600">{row.size_label || '—'}</td>
            <td className={`px-6 py-3 text-right font-semibold ${Number(row.current_stock) < 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {Number(row.current_stock).toFixed(3)}
            </td>
            <td className="px-6 py-3 text-gray-500">{row.unit}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
