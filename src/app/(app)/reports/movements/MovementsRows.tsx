'use client'

import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const fmtC = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const entryTypeConfig: Record<string, { label: string; color: string; isIn: boolean }> = {
  PURCHASE_IN:          { label: 'Purchase In',      color: 'bg-green-100 text-green-800', isIn: true },
  PURCHASE_CANCEL:       { label: 'Purchase Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: false },
  TRANSFER_IN:           { label: 'Transfer In',      color: 'bg-blue-100 text-blue-800',   isIn: true },
  TRANSFER_OUT:          { label: 'Transfer Out',     color: 'bg-orange-100 text-orange-800', isIn: false },
  SALE_OUT:              { label: 'Dispatch',         color: 'bg-red-100 text-red-800',     isIn: false },
  SALE_CANCEL:           { label: 'Dispatch Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUT:          { label: 'Job Work Out',     color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_RETURN_IN:    { label: 'Job Work Return',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_CANCEL:       { label: 'Job Work Cancel',  color: 'bg-gray-100 text-gray-800',   isIn: true },
  JOB_WORK_OUTPUT_IN:    { label: 'Job Work Output',  color: 'bg-teal-100 text-teal-800',   isIn: true },
  JOB_WORK_TRANSFER_OUT: { label: 'JW Transfer Out',  color: 'bg-purple-100 text-purple-800', isIn: false },
  JOB_WORK_TRANSFER_IN:  { label: 'JW Transfer In',   color: 'bg-purple-100 text-purple-800', isIn: true },
  VENDOR_RETURN_IN:      { label: 'Vendor Return',    color: 'bg-teal-100 text-teal-800',   isIn: true },
  ADJUSTMENT_IN:         { label: 'Adjustment In',    color: 'bg-gray-100 text-gray-800',   isIn: true },
  ADJUSTMENT_OUT:        { label: 'Adjustment Out',   color: 'bg-gray-100 text-gray-800',   isIn: false },
}

export type MovementRow = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number: string | null
  reference_type: string | null
  reference_id?: string | null
  purchase_line_id: string | null
  sub_purchase_line_id: string | null
  size_label: string | null
  notes: string | null
  material_type_id: string | null
  material_size_id: string | null
  warehouse_id: string | null
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
  runningBalance?: number
  rate: number | null
  value: number | null
}

export function MovementsRows({
  movements,
}: {
  movements: MovementRow[]
}) {
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(movements, {
    date: (m) => m.entry_date,
    type: (m) => entryTypeConfig[m.entry_type]?.label ?? m.entry_type,
    company: (m) => m.companies?.name ?? '',
    warehouse: (m) => m.warehouses?.name ?? '',
    material: (m) => m.material_types?.description ?? '',
    size: (m) => m.material_sizes?.size_label ?? m.size_label ?? '',
    qty: (m) => Number(m.quantity),
    running_balance: (m) => m.runningBalance ?? 0,
    rate: (m) => m.rate,
    value: (m) => m.value,
    reference: (m) => m.reference_id ?? '',
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Type" sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Qty (T)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh
            label="Running Balance"
            sortKey="running_balance"
            activeKey={sortKey}
            dir={sortDir}
            onSort={toggleSort}
            align="right"
            className="!normal-case !text-indigo-700 bg-indigo-50"
          />
          <SortableTh label="Rate" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case !text-teal-700 bg-teal-50" />
          <SortableTh label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case !text-teal-700 bg-teal-50" />
          <SortableTh label="Reference" sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((m) => {
          const cfg = entryTypeConfig[m.entry_type] ?? { label: m.entry_type, color: 'bg-gray-100 text-gray-800', isIn: Number(m.quantity) >= 0 }
          const isIn = cfg.isIn
          const rate = m.rate
          const value = m.value
          return (
            <tr key={m.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-600">{formatDate(m.entry_date)}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                  {cfg.label}
                </span>
              </td>
              <td className="px-4 py-3">{m.companies?.name}</td>
              <td className="px-4 py-3 text-gray-500">{m.warehouses?.name}</td>
              <td className="px-4 py-3 font-medium">{m.material_types?.description}</td>
              <td className="px-4 py-3 text-gray-500">{m.material_sizes?.size_label ?? m.size_label ?? '—'}</td>
              <td className={`px-4 py-3 text-right font-medium ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                {isIn ? '+' : '-'}{Math.abs(Number(m.quantity)).toFixed(3)}
              </td>
              <td className={`px-4 py-3 text-right font-medium bg-indigo-50/40 ${(m.runningBalance ?? 0) < 0 ? 'text-red-600' : 'text-indigo-800'}`}>
                {Number(m.runningBalance ?? 0).toFixed(3)}
              </td>
              <td className="px-4 py-3 text-right text-teal-700 bg-teal-50/40">{rate != null ? fmtC(rate) : '—'}</td>
              <td className={`px-4 py-3 text-right font-medium bg-teal-50/40 ${value != null && value < 0 ? 'text-red-600' : 'text-teal-800'}`}>
                {value != null ? fmtC(value) : '—'}
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs">{m.reference_id ?? '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </>
  )
}
