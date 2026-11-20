import { readJson, trackingRoute } from '@/lib/tracking/http'
import { cancelCount, decideCountLine, getCountDetail } from '@/lib/tracking/counts'
import { TrackingError } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ actor, params }) => getCountDetail(actor, params.id))

// Deciding needs the manage permission, checked in the count service.
export const POST = trackingRoute<{ id: string }>('operate', async ({ request, actor, params }) => {
  const body = await readJson(request)
  switch (body.action) {
    case 'decide':
      return decideCountLine(actor, params.id, body.line_id, body.decision, body.note)
    case 'cancel':
      return cancelCount(actor, params.id, body.reason)
    default:
      throw new TrackingError('Unknown action')
  }
})
