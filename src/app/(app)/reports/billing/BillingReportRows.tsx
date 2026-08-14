'use client'

import { formatDate } from '@/lib/utils'
import { useTableSort } from '@/lib/useTableSort'
import { SortableTh } from '@/components/table/SortableTh'

type PurchaseBillItem = {
  quantity: number | string
  rate: number | string | null
  amount: number | string | null
  size_label: string | null
  material_types: { description: string | null; unit?: string | null } | null
  material_sizes: { size_label: string | null } | null
}

export type PurchaseBillRow = {
  id: string
  bill_number: string
  bill_date: string
  companies: { name: string; code?: string | null } | null
  warehouses: { name: string } | null
  suppliers: { name: string } | null
  purchase_bill_items: PurchaseBillItem[]
}

function sortValue(bill: PurchaseBillRow, key: string): string | number {
  const first = bill.purchase_bill_items?.[0] ?? null
  switch (key) {
    case 'bill_number': return bill.bill_number ?? ''
    case 'date': return bill.bill_date
    case 'supplier': return bill.suppliers?.name ?? ''
    case 'company': return bill.companies?.name ?? ''
    case 'warehouse': return bill.warehouses?.name ?? ''
    case 'material': return first?.material_types?.description ?? ''
    case 'size': return first?.material_sizes?.size_label ?? first?.size_label ?? ''
    case 'qty': return first ? Number(first.quantity) : 0
    case 'rate': return first?.rate ? Number(first.rate) : 0
    case 'amount': return first?.amount ? Number(first.amount) : 0
    default: return ''
  }
}

export function BillingReportRows({ bills }: { bills: PurchaseBillRow[] }) {
  const keys = ['bill_number', 'date', 'supplier', 'company', 'warehouse', 'material', 'size', 'qty', 'rate', 'amount']
  const accessors = Object.fromEntries(keys.map((k) => [k, (b: PurchaseBillRow) => sortValue(b, k)]))
  const { sortedRows, sortKey, sortDir, toggleSort } = useTableSort(bills, accessors)

  return (
    <>
      <thead className="sticky top-0 z-10">
        <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
          <SortableTh label="Bill No." sortKey="bill_number" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Date" sortKey="date" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Supplier" sortKey="supplier" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Company" sortKey="company" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Warehouse" sortKey="warehouse" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Material" sortKey="material" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="!normal-case" />
          <SortableTh label="Qty (T)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Rate" sortKey="rate" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
          <SortableTh label="Amount (₹)" sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="!normal-case" />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {sortedRows.map((bill) => {
          const items = bill.purchase_bill_items ?? []
          if (items.length === 0) {
            return (
              <tr key={bill.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-blue-700">{bill.bill_number}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(bill.bill_date)}</td>
                <td className="px-4 py-3">{bill.suppliers?.name}</td>
                <td className="px-4 py-3">{bill.companies?.name}</td>
                <td className="px-4 py-3">{bill.warehouses?.name}</td>
                <td className="px-4 py-3 text-gray-400" colSpan={4}>No items</td>
              </tr>
            )
          }
          return items.map((item, idx: number) => (
            <tr key={`${bill.id}-${idx}`} className="hover:bg-gray-50">
              {idx === 0 && (
                <>
                  <td className="px-4 py-3 font-medium text-blue-700" rowSpan={items.length}>{bill.bill_number}</td>
                  <td className="px-4 py-3 text-gray-600" rowSpan={items.length}>{formatDate(bill.bill_date)}</td>
                  <td className="px-4 py-3" rowSpan={items.length}>{bill.suppliers?.name}</td>
                  <td className="px-4 py-3" rowSpan={items.length}>{bill.companies?.name}</td>
                  <td className="px-4 py-3" rowSpan={items.length}>{bill.warehouses?.name}</td>
                </>
              )}
              <td className="px-4 py-3 font-medium">{item.material_types?.description}</td>
              <td className="px-4 py-3 text-gray-500">{item.material_sizes?.size_label ?? item.size_label ?? '—'}</td>
              <td className="px-4 py-3 text-right">{Number(item.quantity).toFixed(3)}</td>
              <td className="px-4 py-3 text-right">{item.rate ? `₹${Number(item.rate).toLocaleString('en-IN')}` : '—'}</td>
              <td className="px-4 py-3 text-right">{item.amount ? `₹${Number(item.amount).toLocaleString('en-IN')}` : '—'}</td>
            </tr>
          ))
        })}
      </tbody>
    </>
  )
}
