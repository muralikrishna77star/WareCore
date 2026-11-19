import { readJson, trackingRoute } from '@/lib/tracking/http'
import { jobWorkOptions, linkMoveTransfer, listMoveTransfers, listRecentMoves, moveUnitsToVendor, vendorStock } from '@/lib/tracking/jobwork'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute('view', async ({ request, actor }) => {
  const params = request.nextUrl.searchParams
  const moveId = params.get('move')
  if (moveId) return { transfers: await listMoveTransfers(actor, moveId, params.get('transfers') ?? '') }
  const { vendors } = await jobWorkOptions(actor)
  return { stock: await vendorStock(actor), moves: await listRecentMoves(actor), vendors }
})

export const POST = trackingRoute('operate', async ({ request, actor }) => {
  const body = await readJson(request)
  switch (body.action) {
    case 'move':
      return { moved: await moveUnitsToVendor(actor, body) }
    case 'link_transfer':
      return { move: await linkMoveTransfer(actor, String(body.move_id ?? ''), body.transfer_id) }
    default:
      throw new TrackingError('Unknown action')
  }
})
