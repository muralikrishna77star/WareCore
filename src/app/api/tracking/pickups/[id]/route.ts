import { readJson, trackingRoute } from '@/lib/tracking/http'
import {
  addPickupUnit, addPickupUnitById, cancelPickup, getPickupDetail, handOverPickup, linkPickupSale, listLinkableSales,
  markPickupReady, recordPickupShare, removePickupUnit, vendorPickupCandidates,
} from '@/lib/tracking/pickups'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ request, actor, params }) => {
  const salesSearch = request.nextUrl.searchParams.get('sales')
  if (salesSearch !== null) return { sales: await listLinkableSales(actor, params.id, salesSearch) }
  if (request.nextUrl.searchParams.get('candidates') !== null) return { candidates: await vendorPickupCandidates(actor, params.id) }
  return getPickupDetail(actor, params.id)
})

// Each action checks its own permission in the pickup service.
export const POST = trackingRoute<{ id: string }>('pickup', async ({ request, actor, params }) => {
  const body = await readJson(request)
  switch (body.action) {
    case 'add_unit':
      return body.unit_id
        ? addPickupUnitById(actor, params.id, body.unit_id, body.reason)
        : addPickupUnit(actor, params.id, body.code, body.reason)
    case 'remove_unit':
      return { pickup: await removePickupUnit(actor, params.id, body.unit_id, body.reason) }
    case 'mark_ready':
      return { pickup: await markPickupReady(actor, params.id, body.bay) }
    case 'hand_over':
      return { pickup: await handOverPickup(actor, params.id, body) }
    case 'cancel':
      return { pickup: await cancelPickup(actor, params.id, body.reason) }
    case 'link_sale':
      return { pickup: await linkPickupSale(actor, params.id, body.sale_id) }
    case 'share':
      return { pickup: await recordPickupShare(actor, params.id, body.phone) }
    default:
      throw new TrackingError('Unknown action')
  }
})
