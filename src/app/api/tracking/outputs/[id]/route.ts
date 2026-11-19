import { readJson, trackingRoute } from '@/lib/tracking/http'
import { getReceiptDetail, linkReceiptOrder, listReceiptOrders } from '@/lib/tracking/jobwork'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ request, actor, params }) => {
  const orderSearch = request.nextUrl.searchParams.get('orders')
  if (orderSearch !== null) return { orders: await listReceiptOrders(actor, params.id, orderSearch) }
  return getReceiptDetail(actor, params.id)
})

export const POST = trackingRoute<{ id: string }>('operate', async ({ request, actor, params }) => {
  const body = await readJson(request)
  if (body.action !== 'link_order') throw new TrackingError('Unknown action')
  return { receipt: await linkReceiptOrder(actor, params.id, body.order_id) }
})
