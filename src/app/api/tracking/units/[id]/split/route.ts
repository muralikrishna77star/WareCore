import { readJson, trackingRoute } from '@/lib/tracking/http'
import { splitUnit } from '@/lib/tracking/floor'

export const POST = trackingRoute<{ id: string }>('manage', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { units: await splitUnit(actor, params.id, body.parts, body.reason) }
})
