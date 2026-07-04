export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_BILLS_QUERY, ACTIVE_SUPPLIERS_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import BillsTable from './BillsTable'
import { ListingFilters } from '@/components/ListingFilters'
import { ListingSummary } from '@/components/ListingSummary'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ line_id?: string; from?: string; to?: string; supplier?: string; item?: string }>
}) {
  const params = await searchParams
  const lineId = params.line_id?.trim() || ''

  const today = new Date()
  const fifteenDaysAgo = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000)
  const fromDate = params.from || fifteenDaysAgo.toISOString().split('T')[0]
  const toDate = params.to || today.toISOString().split('T')[0]

  const conditions: Record<string, unknown>[] = [
    { bill_date: { _gte: fromDate } },
    { bill_date: { _lte: toDate } },
  ]
  if (lineId) conditions.push({ purchase_bill_items: { purchase_line_id: { _ilike: `%${lineId}%` } } })
  if (params.supplier) conditions.push({ supplier_id: { _eq: params.supplier } })
  if (params.item) conditions.push({ purchase_bill_items: { item_master_id: { _eq: params.item } } })

  const [billsResult, suppliersResult, itemsResult] = await Promise.all([
    hasuraQuery(PURCHASE_BILLS_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])
  const bills = billsResult.purchase_bills ?? []
  const suppliers: { id: string; name: string }[] = suppliersResult.suppliers ?? []
  const itemOptions: { id: string; item_code: string; item_name: string }[] = itemsResult.item_master ?? []

  const totalQuantity = bills.reduce((s: number, b: any) => s + Number(b.total_quantity || 0), 0)
  const totalAmount = bills.reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.4375rem] font-bold text-gray-900">Purchase Bills</h1>
          <p className="mt-1 text-[0.9375rem] text-gray-500">All inward purchase bills</p>
        </div>
        <Link
          href="/bills/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[0.9375rem] font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Bill
        </Link>
      </div>

      <ListingSummary
        count={bills.length}
        countLabel="bill"
        totalQuantity={totalQuantity}
        totalAmount={totalAmount}
      />

      <ListingFilters
        basePath="/bills"
        fromDate={fromDate}
        toDate={toDate}
        partyLabel="Supplier"
        partyName="supplier"
        partyValue={params.supplier || ''}
        partyOptions={suppliers}
        itemValue={params.item || ''}
        itemOptions={itemOptions}
        extra={
          <div>
            <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">Purchase Line ID</label>
            <input
              type="text"
              name="line_id"
              defaultValue={lineId}
              placeholder="e.g. CR0426-0001"
              className="rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] w-56"
            />
          </div>
        }
      />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!bills || bills.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-[1.1875rem] mb-3">📋</p>
              {lineId ? (
                <p className="text-gray-500">No purchase bills found with a line item matching &quot;{lineId}&quot;.</p>
              ) : (
                <p className="text-gray-500">No purchase bills in the selected range.</p>
              )}
            </div>
          ) : (
            <BillsTable bills={bills} highlight={lineId} />
          )}
        </div>
      </div>
    </div>
  )
}
