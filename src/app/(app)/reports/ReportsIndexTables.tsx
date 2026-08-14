'use client'

import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

type InventoryRow = { company: string; code: string; material: string; qty: number }

export function InventoryByCompanyRows({ inventoryByCompany }: {
  inventoryByCompany: Record<string, { code: string; materials: Record<string, number> }>
}) {
  const flat: InventoryRow[] = Object.entries(inventoryByCompany).flatMap(([company, { code, materials }]) =>
    Object.entries(materials).map(([material, qty]) => ({ company, code, material, qty }))
  )
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(flat, {
    company: (r) => r.company,
    material: (r) => r.material,
    qty: (r) => r.qty,
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 border-b">
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Material (Size)" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Stock (Tons)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((r, idx) => (
          <tr key={`${r.company}-${r.material}-${idx}`} className="hover:bg-gray-50">
            <td className="px-6 py-3">
              <div>
                <p className="font-medium text-gray-900">{r.company}</p>
                <p className="text-xs text-gray-500">{r.code}</p>
              </div>
            </td>
            <td className="px-6 py-3 text-gray-700">{r.material}</td>
            <td className="px-6 py-3 text-right font-semibold text-gray-900">{r.qty.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}

export type StockAtVendorRow = {
  vendor_name: string
  material_type_name: string
  size_label: string | null
  pending_quantity: number | string
}

export function StockAtVendorsRows({ jwRows }: { jwRows: StockAtVendorRow[] }) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(jwRows, {
    vendor: (r) => r.vendor_name,
    material: (r) => r.material_type_name,
    size: (r) => r.size_label ?? '',
    pending: (r) => Number(r.pending_quantity),
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="bg-gray-50 border-b">
          <SortableTh label="Vendor" sortKey="vendor" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
          <SortableTh label="Pending (Tons)" sortKey="pending" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((row, i) => (
          <tr key={i} className="hover:bg-gray-50">
            <td className="px-6 py-3 font-medium text-gray-900">{row.vendor_name}</td>
            <td className="px-6 py-3 text-gray-700">{row.material_type_name}</td>
            <td className="px-6 py-3 text-gray-500">{row.size_label || '—'}</td>
            <td className="px-6 py-3 text-right font-semibold text-orange-700">{Number(row.pending_quantity).toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </>
  )
}
