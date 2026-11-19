import { readJson, trackingRoute } from '@/lib/tracking/http'
import { placeUnit } from '@/lib/tracking/floor'

export const POST = trackingRoute<{ id: string }>('operate', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { unit: await placeUnit(actor, params.id, body.location, body.position) }
})
