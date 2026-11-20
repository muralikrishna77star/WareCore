import { readJson, trackingRoute } from '@/lib/tracking/http'
import { reviewSyncProblem } from '@/lib/tracking/offline'

export const POST = trackingRoute<{ id: string }>('manage', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { problem: await reviewSyncProblem(actor, params.id, body.note) }
})
