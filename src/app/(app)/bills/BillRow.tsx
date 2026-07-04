'use client'

import { useState } from 'react'
import { formatDate } from '@/lib/utils'
import { ReferenceLink } from '@/components/ReferenceLink'

export default function BillRow({ bill, highlight }: { bill: any; highlight?: string }) {
  const items = bill.purchase_bill_items ?? []
  const needle = highlight?.trim().toLowerCase() || ''
  const isMatch = (item: any) => !!needle && (item.purchase_line_id ?? '').toLowerCase().includes(needle)
  const hasMatch = needle ? items.some(isMatch) : false

  const [expanded, setExpanded] = useState(hasMatch)
  const cancelled = bill.status === 'cancelled'
  const draft = bill.status === 'draft'

  return (
    <>
      <tr className={`hover:bg-gray-50 ${cancelled ? 'opacity-60' : ''} ${draft ? 'bg-amber-50/40' : ''}`}>
        <td className={`px-6 py-3 font-medium whitespace-nowrap ${cancelled ? 'text-gray-400 line-through' : draft ? 'text-amber-700' : 'text-blue-600'}`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            disabled={items.length === 0}
            className="mr-2 inline-flex w-4 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            aria-label={expanded ? 'Collapse line items' : 'Expand line items'}
          >
            {expanded ? '▾' : '▸'}
          </button>
          {bill.bill_number}
        </td>
        <td className="px-6 py-3 text-gray-700 whitespace-nowrap">
          {formatDate(bill.bill_date)}
        </td>
        <td className="px-6 py-3 text-gray-700">
          {bill.suppliers?.name || '-'}
        </td>
        <td className="px-6 py-3">
          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[0.6875rem] font-medium text-blue-700">
            {bill.companies?.name}
          </span>
        </td>
        <td className="px-6 py-3 text-gray-600">
          {bill.warehouses?.name || '-'}
        </td>
        <td className="px-6 py-3 text-right font-medium text-gray-700">
          {Number(bill.total_quantity || 0).toFixed(3)}
        </td>
        <td className="px-6 py-3 text-right font-medium text-gray-700">
          ₹{Number(bill.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </td>
        <td className="px-6 py-3">
          {cancelled ? (
            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[0.6875rem] font-medium text-red-600 border border-red-200">Cancelled</span>
          ) : draft ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-medium text-amber-700 border border-amber-200">Draft</span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[0.6875rem] font-medium text-green-700">Active</span>
          )}
        </td>
        <td className="px-6 py-3 text-gray-600 max-w-xs truncate" title={bill.notes || ''}>
          {bill.notes || '—'}
        </td>
        <td className="px-6 py-3">
          <ReferenceLink type="purchase_bill" id={bill.id} className="text-blue-600 hover:text-blue-800 text-[0.6875rem] font-medium">
            View
          </ReferenceLink>
        </td>
      </tr>
      {expanded && items.length > 0 && (
        <tr className="bg-gray-50/60">
          <td colSpan={10} className="px-6 py-3">
            <div className="pl-8 space-y-1.5">
              {items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 text-[0.8125rem]">
                  <span className="text-gray-600 min-w-[12rem]">{item.item_name || '—'}</span>
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-[0.75rem] font-mono font-medium whitespace-nowrap select-all ${
                      isMatch(item)
                        ? 'bg-yellow-100 border-yellow-400 text-yellow-800 ring-2 ring-yellow-300'
                        : 'bg-blue-50 border-blue-200 text-blue-700'
                    }`}
                  >
                    {item.purchase_line_id ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
