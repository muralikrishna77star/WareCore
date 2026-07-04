export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { TRANSFERS_QUERY, TRANSFERS_MAX_CREATED_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import { defaultCreatedRange, nextDay } from '@/lib/dateRange'
import { ListingFilters } from '@/components/ListingFilters'
import { ListingSummary } from '@/components/ListingSummary'
import { ReferenceLink } from '@/components/ReferenceLink'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  in_transit: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; item?: string }>
}) {
  const params = await searchParams

  const maxCreatedResult = await hasuraQuery(TRANSFERS_MAX_CREATED_QUERY)
  const maxCreatedAt = maxCreatedResult.transfers_aggregate?.aggregate?.max?.created_at
  const defaults = defaultCreatedRange(maxCreatedAt)
  const fromDate = params.from || defaults.from
  const toDate = params.to || defaults.to

  const conditions: Record<string, unknown>[] = [
    { created_at: { _gte: fromDate } },
    { created_at: { _lt: nextDay(toDate) } },
  ]
  if (params.item) conditions.push({ transfer_items: { item_master_id: { _eq: params.item } } })

  const [result, itemsResult] = await Promise.all([
    hasuraQuery(TRANSFERS_QUERY, { where: { _and: conditions } }),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])
  const transfers = result.transfers ?? []
  const itemOptions: { id: string; item_code: string; item_name: string }[] = itemsResult.item_master ?? []

  const totalQuantity = transfers.reduce(
    (s: number, t: any) => s + (t.transfer_items ?? []).reduce((s2: number, i: any) => s2 + Number(i.quantity || 0), 0),
    0
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transfers</h1>
          <p className="mt-1 text-sm text-gray-500">Inter-company and inter-warehouse material transfers</p>
        </div>
        <Link
          href="/transfers/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + New Transfer
        </Link>
      </div>

      <ListingSummary count={transfers.length} countLabel="transfer" totalQuantity={totalQuantity} />

      <ListingFilters
        basePath="/transfers"
        fromDate={fromDate}
        toDate={toDate}
        itemValue={params.item || ''}
        itemOptions={itemOptions}
      />

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!transfers || transfers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">↔️</p>
              <p className="text-gray-500">No transfers in the selected range.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 text-left border-b">
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">From</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">To</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Items</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map((t: any) => {
                  const items = t.transfer_items ?? []
                  const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity), 0)

                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(t.transfer_date)}</td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{t.companies_from?.code || '—'}</p>
                        <p className="text-xs text-gray-500">{t.warehouses_from?.name || '—'}</p>
                      </td>
                      <td className="px-6 py-3">
                        <p className="font-medium text-gray-900">{t.companies_to?.code || '—'}</p>
                        <p className="text-xs text-gray-500">{t.warehouses_to?.name || '—'}</p>
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-gray-700">{items.length} item{items.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-gray-500">{totalQty.toFixed(3)} tons</p>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColors[t.status] || 'bg-gray-100 text-gray-700'}`}>
                          {t.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <ReferenceLink type="transfer" id={t.id}>
                          View
                        </ReferenceLink>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
