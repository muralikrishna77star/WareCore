export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_ORDERS_QUERY } from '@/lib/hasura/queries'
import DispatchTable from './DispatchTable'

export default async function DispatchPage() {
  const result = await hasuraQuery(DISPATCH_ORDERS_QUERY)
  const orders = result.dispatch_orders ?? []

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

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          {!orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-4xl mb-3">🚚</p>
              <p className="text-gray-500">No sale entries yet.</p>
              <Link href="/dispatch/new" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
                Create first sale →
              </Link>
            </div>
          ) : (
            <DispatchTable orders={orders} />
          )}
        </div>
      </div>
    </div>
  )
}
