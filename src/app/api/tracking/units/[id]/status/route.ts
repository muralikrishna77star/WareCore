import { readJson, trackingRoute } from '@/lib/tracking/http'
import { changeUnitStatus } from '@/lib/tracking/floor'

export const POST = trackingRoute<{ id: string }>('manage', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { unit: await changeUnitStatus(actor, params.id, body.to, body) }
})
