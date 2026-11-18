import { readJson, trackingRoute } from '@/lib/tracking/http'
import { setPrintStatus } from '@/lib/tracking/service'

export const PATCH = trackingRoute<{ id: string }>('label', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { status: await setPrintStatus(actor, params.id, body.status) }
})
