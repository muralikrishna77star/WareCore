export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { hasuraQuery } from '@/lib/hasura/server'
import {
  ACTIVE_JOB_WORK_ORDERS_PENDING_QUERY,
  ACTIVE_SUPPLIERS_QUERY,
  ACTIVE_ITEM_MASTER_QUERY,
} from '@/lib/hasura/queries'
import VendorDirectSaleBrowseTable from './VendorDirectSaleBrowseTable'

interface JobWorkItemPending {
  id: string
  item_name: string | null
  material_type_id: string
  size_label: string | null
  quantity_sent: number | string
  quantity_received: number | string | null
  quantity_transferred_out: number | string | null
  unit: string
  item_master_id: string | null
  material_types?: { description: string | null } | null
}

interface JobWorkOrderPending {
  id: string
  reference_number: string | null
  dispatch_date: string
  status: string
  vendor_id: string
  suppliers?: { name: string } | null
  companies?: { name: string } | null
  job_work_items: JobWorkItemPending[]
}

export default async function VendorDirectSaleBrowsePage() {
  const [ordersResult, vendorsResult, itemsResult] = await Promise.all([
    hasuraQuery(ACTIVE_JOB_WORK_ORDERS_PENDING_QUERY),
    hasuraQuery(ACTIVE_SUPPLIERS_QUERY),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY),
  ])

  const orders: JobWorkOrderPending[] = ordersResult.job_work_orders ?? []
  const vendors: { id: string; name: string }[] = vendorsResult.suppliers ?? []
  const itemOptions: { id: string; item_code: string; item_name: string }[] = itemsResult.item_master ?? []

  // Only job work orders that still have quantity pending at the vendor can be
  // sold direct — fully returned/transferred/sold-out lines don't belong here.
  const sellableOrders = orders.filter((o) =>
    (o.job_work_items ?? []).some(
      (i) =>
        Number(i.quantity_sent) - Number(i.quantity_received ?? 0) - Number(i.quantity_transferred_out ?? 0) > 0.0005
    )
  )

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dispatch" className="text-sm text-blue-600 hover:underline mb-1 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4 shrink-0" /> Back to Sale Entry
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Sell from Vendor</h1>
        <p className="mt-1 text-sm text-gray-500">
          Find a job work order with pending stock at the vendor, then sell it direct to a customer.
        </p>
      </div>

      <VendorDirectSaleBrowseTable orders={sellableOrders} vendors={vendors} itemOptions={itemOptions} />
    </div>
  )
}
