export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_ORDERS_QUERY, DISPATCH_ORDERS_MAX_CREATED_QUERY, ACTIVE_CUSTOMERS_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import { defaultCreatedRange, nextDay } from '@/lib/dateRange'
import DispatchTable from './DispatchTable'
import { ListingFilters } from '@/components/ListingFilters'
import { ListingSummary } from '@/components/ListingSummary'

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; customer?: string; item?: string }>
}) {
  const params = await searchParams

  const maxCreatedResult = await hasuraQuery(DISPATCH_ORDERS_MAX_CREATED_QUERY)
  const maxCreatedAt = maxCreatedResult.dispatch_orders_aggregate?.aggregate?.max?.created_at
  const defaults = defaultCreatedRange(maxCreatedAt)
  const fromDate = params.from || defaults.from
  const toDate = params.to || defaults.to

  const conditions: Record<string, unknown>[] = [
    { created_at: { _gte: fromDate } },
    { created_at: { _lt: nextDay(toDate) } },
  ]
  if (params.customer) conditions.push({ customer_id: { _eq: params.customer } })
  if (params.item) conditions.push({ dispatch_items: { item_master_id: { _eq: params.item } } })

  const [ordersResult, customersResult, itemsResult] = await Promise.all([
    hasuraQuery(DISPATCH_ORDERS_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_CUSTOMERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])
  const orders = ordersResult.dispatch_orders ?? []
  const customers: { id: string; name: string }[] = customersResult.customers ?? []
  const itemOptions: { id: string; item_code: string; item_name: string }[] = itemsResult.item_master ?? []

  const totalQuantity = orders.reduce(
    (s: number, o: any) => s + (o.dispatch_items ?? []).reduce((s2: number, i: any) => s2 + Number(i.quantity || 0), 0),
    0
  )
  const totalAmount = orders.reduce(
    (s: number, o: any) => s + (o.dispatch_items ?? []).reduce((s2: number, i: any) => s2 + Number(i.amount || 0), 0),
    0
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sale Entry</h1>
          <p className="mt-1 text-sm text-gray-500">Sales invoices and customer dispatches</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dispatch/vendor-direct/new"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
          >
            Sell from Vendor
          </Link>
          <Link
            href="/dispatch/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            + New Sale
          </Link>
        </div>
      </div>

      <ListingSummary count={orders.length} countLabel="sale" totalQuantity={totalQuantity} totalAmount={totalAmount} />

      <ListingFilters
        basePath="/dispatch"
        fromDate={fromDate}
        toDate={toDate}
        partyLabel="Customer"
        partyName="customer"
        partyValue={params.customer || ''}
        partyOptions={customers}
        itemValue={params.item || ''}
        itemOptions={itemOptions}
      />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🚚</p>
              <p className="text-gray-500">No sale entries in the selected range.</p>
            </div>
          ) : (
            <DispatchTable orders={orders} fromDate={fromDate} toDate={toDate} />
          )}
        </div>
      </div>
    </div>
  )
}
