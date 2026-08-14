'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

const entryTypeConfig: Record<string, { label: string; color: string }> = {
  PURCHASE_IN: { label: 'Purchase In', color: 'bg-green-100 text-green-800' },
  VENDOR_RETURN_IN: { label: 'Vendor Return In', color: 'bg-green-100 text-green-800' },
  SALE_OUT: { label: 'Sale / Dispatch', color: 'bg-red-100 text-red-800' },
  SALE_CANCEL: { label: 'Sale Cancelled', color: 'bg-gray-100 text-gray-700' },
  PURCHASE_CANCEL: { label: 'Purchase Cancelled', color: 'bg-gray-100 text-gray-700' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'bg-orange-100 text-orange-800' },
  TRANSFER_IN: { label: 'Transfer In', color: 'bg-blue-100 text-blue-800' },
  JOB_WORK_OUT: { label: 'Job Work Out', color: 'bg-purple-100 text-purple-800' },
  JOB_WORK_RETURN_IN: { label: 'Job Work Return In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_OUTPUT_IN: { label: 'Job Work Output In', color: 'bg-teal-100 text-teal-800' },
  JOB_WORK_CANCEL: { label: 'Job Work Cancelled', color: 'bg-gray-100 text-gray-700' },
  ADJUSTMENT_IN: { label: 'Adjustment In', color: 'bg-gray-100 text-gray-800' },
  ADJUSTMENT_OUT: { label: 'Adjustment Out', color: 'bg-gray-100 text-gray-800' },
}

const referenceBasePath: Record<string, string> = {
  purchase_bill: '/bills',
  dispatch: '/dispatch',
  job_work: '/jobwork',
  transfer: '/transfers',
}

export type PurchaseLineLedgerRow = {
  id: string
  entry_type: string
  quantity: number | string
  entry_date: string
  reference_number?: string | null
  reference_type?: string | null
  reference_id?: string | null
  sub_purchase_line_id?: string | null
  size_label?: string | null
  notes?: string | null
  companies?: { name: string } | null
  warehouses?: { name: string } | null
  material_sizes?: { size_label: string } | null
  material_type_id?: string | null
  material_size_id?: string | null
  material_types?: { description: string; unit: string } | null
  balance: number
}

const fmtQ = (n: number) => n.toFixed(3)

export function PurchaseLineLedgerRows({
  rows: allRows,
  itemLabelFor,
}: {
  rows: PurchaseLineLedgerRow[]
  itemLabelFor: (row: PurchaseLineLedgerRow) => string
}) {
  const { sortedRows: rows, sortKey, sortDir, toggleSort } = useTableSort(allRows, {
    date: (r) => r.entry_date,
    type: (r) => entryTypeConfig[r.entry_type]?.label ?? r.entry_type,
    item: (r) => itemLabelFor(r),
    reference: (r) => r.reference_number ?? '',
    linked_line: (r) => r.sub_purchase_line_id ?? '',
    company: (r) => r.companies?.name ?? '',
    warehouse: (r) => r.warehouses?.name ?? '',
    in: (r) => { const q = Number(r.quantity); return q > 0 ? q : null },
    out: (r) => { const q = Number(r.quantity); return q < 0 ? Math.abs(q) : null },
    balance: (r) => r.balance,
    notes: (r) => r.notes ?? '',
  })

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-[11px] uppercase text-gray-500">
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Type" sortKey="type" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Item" sortKey="item" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Reference" sortKey="reference" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Linked Line ID" sortKey="linked_line" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="In" sortKey="in" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Out" sortKey="out" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Balance" sortKey="balance" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!px-2 !py-1.5 !normal-case" />
          <SortableTh label="Notes" sortKey="notes" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!px-2 !py-1.5 !normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((row) => {
          const cfg = entryTypeConfig[row.entry_type] ?? { label: row.entry_type, color: 'bg-gray-100 text-gray-800' }
          const qty = Number(row.quantity)
          const basePath = row.reference_type ? referenceBasePath[row.reference_type] : undefined
          return (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{formatDate(row.entry_date)}</td>
              <td className="px-2 py-1">
                <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cfg.color}`}>
                  {cfg.label}
                </span>
              </td>
              <td className="px-2 py-1 text-gray-700 whitespace-nowrap">
                {itemLabelFor(row)}
                {(row.material_sizes?.size_label || row.size_label) && (
                  <span className="ml-1 text-[11px] text-gray-400">({row.material_sizes?.size_label || row.size_label})</span>
                )}
              </td>
              <td className="px-2 py-1 text-gray-500 text-[11px] whitespace-nowrap">
                {basePath && row.reference_id ? (
                  <Link href={`${basePath}/${row.reference_id}`} className="text-blue-600 hover:underline">
                    {row.reference_number || '—'}
                  </Link>
                ) : (
                  row.reference_number || '—'
                )}
              </td>
              <td className="px-2 py-1">
                {row.sub_purchase_line_id ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {row.sub_purchase_line_id}
                  </span>
                ) : <span className="text-[11px] text-gray-300">—</span>}
              </td>
              <td className="px-2 py-1 text-gray-700">{row.companies?.name || '—'}</td>
              <td className="px-2 py-1 text-gray-500">{row.warehouses?.name || '—'}</td>
              <td className="px-2 py-1 text-right text-green-700 font-medium">{qty > 0 ? fmtQ(qty) : ''}</td>
              <td className="px-2 py-1 text-right text-red-600 font-medium">{qty < 0 ? fmtQ(Math.abs(qty)) : ''}</td>
              <td className={`px-2 py-1 text-right font-semibold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {fmtQ(row.balance)}
              </td>
              <td className="px-2 py-1 text-gray-500 text-[11px]">{row.notes || '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </>
  )
}
