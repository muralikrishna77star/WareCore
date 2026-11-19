import { readJson, trackingRoute } from '@/lib/tracking/http'
import {
  addDispatchUnit, cancelDispatch, getDispatchDetail, linkDispatchOrder, listDispatchOrders, removeDispatchUnit, sendDispatch,
} from '@/lib/tracking/jobwork'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ request, actor, params }) => {
  const orderSearch = request.nextUrl.searchParams.get('orders')
  if (orderSearch !== null) return { orders: await listDispatchOrders(actor, params.id, orderSearch) }
  return getDispatchDetail(actor, params.id)
})

// Each action checks its own permission in the job work service.
export const POST = trackingRoute<{ id: string }>('operate', async ({ request, actor, params }) => {
  const body = await readJson(request)
  switch (body.action) {
    case 'add_unit':
      return { dispatch: await addDispatchUnit(actor, params.id, body.code) }
    case 'remove_unit':
      return { dispatch: await removeDispatchUnit(actor, params.id, body.unit_id, body.reason) }
    case 'send':
      return { dispatch: await sendDispatch(actor, params.id, body) }
    case 'cancel':
      return { dispatch: await cancelDispatch(actor, params.id, body.reason) }
    case 'link_order':
      return { dispatch: await linkDispatchOrder(actor, params.id, body.order_id) }
    default:
      throw new TrackingError('Unknown action')
  }
})
