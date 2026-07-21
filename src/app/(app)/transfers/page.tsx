export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { TRANSFERS_QUERY, TRANSFERS_MAX_CREATED_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import { defaultCreatedRange, nextDay } from '@/lib/dateRange'
import { ListingSummary } from '@/components/ListingSummary'
import TransfersTable from './TransfersTable'

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

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <TransfersTable
            transfers={transfers ?? []}
            fromDate={fromDate}
            toDate={toDate}
            basePath="/transfers"
            itemOptions={itemOptions}
            itemValue={params.item || ''}
            emptyMessage="No transfers in the selected range."
          />
        </div>
      </div>
    </div>
  )
}
