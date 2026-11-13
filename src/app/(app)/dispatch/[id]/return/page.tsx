export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { hasuraQuery } from '@/lib/hasura/server'
import { DISPATCH_ORDER_BY_ID_QUERY, DISPATCH_ITEMS_QUERY, SALE_RETURNS_BY_DISPATCH_QUERY } from '@/lib/hasura/queries'
import SaleReturnForm, { type ReturnableLine } from './SaleReturnForm'

interface SaleReturnSummary {
  status: string
  sale_return_items: { dispatch_item_id: string | null; quantity: number | string }[]
}

export default async function NewSaleReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [orderResult, itemsResult, returnsResult] = await Promise.all([
    hasuraQuery(DISPATCH_ORDER_BY_ID_QUERY, { id }),
    hasuraQuery(DISPATCH_ITEMS_QUERY, { dispatch_order_id: id }),
    hasuraQuery(SALE_RETURNS_BY_DISPATCH_QUERY, { dispatch_order_id: id }),
  ])
  const order = orderResult.dispatch_orders_by_pk
  if (!order) notFound()

  // Already returned per sale line — active returns only (a cancelled
  // return gave its stock back and no longer counts).
  const returned = new Map<string, number>()
  for (const r of (returnsResult.sale_returns ?? []) as SaleReturnSummary[]) {
    if (r.status !== 'active') continue
    for (const li of r.sale_return_items) {
      if (!li.dispatch_item_id) continue
      returned.set(li.dispatch_item_id, (returned.get(li.dispatch_item_id) ?? 0) + Number(li.quantity))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: ReturnableLine[] = (itemsResult.dispatch_items ?? []).map((i: any) => {
    const sold = Number(i.quantity) || 0
    const already = returned.get(i.id) ?? 0
    return {
      id: i.id,
      itemCode: i.item_master?.item_code ?? null,
      itemName: i.item_name ?? null,
      material: i.material_types?.description ?? null,
      saleLineId: i.sale_line_id ?? null,
      purchaseLineId: i.purchase_line_id ?? null,
      size: i.size_label ?? null,
      sold,
      alreadyReturned: already,
      remaining: Math.max(0, Math.round((sold - already) * 1000) / 1000),
      rate: i.rate != null ? Number(i.rate) : null,
    }
  })

  const blocked = order.status !== 'active'

  return (
    <div className="w-full max-w-[1920px] mx-auto">
      <div className="mb-4">
        <Link href={`/dispatch/${id}`} className="text-sm text-blue-600 hover:underline mb-1 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4 shrink-0" /> Back to Sale {order.invoice_number}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Customer Return</h1>
        <p className="text-sm text-gray-500 mt-1">
          Goods sent back by <span className="font-medium text-gray-700">{order.customers?.name ?? 'the customer'}</span> against
          sale <span className="font-mono">{order.invoice_number}</span> of {formatDate(order.dispatch_date)}.
          Returned stock goes back into <span className="font-medium text-gray-700">{order.warehouses?.name ?? 'the sale’s warehouse'}</span> ({order.companies?.name ?? '—'}).
        </p>
      </div>

      {blocked ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Returns can only be entered against an active sale. This sale is {order.status}.
        </div>
      ) : (
        <SaleReturnForm orderId={id} saleDate={order.dispatch_date} lines={lines} />
      )}
    </div>
  )
}
