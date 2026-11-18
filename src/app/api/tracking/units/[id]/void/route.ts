import { readJson, trackingRoute } from '@/lib/tracking/http'
import { voidUnit } from '@/lib/tracking/service'

export const POST = trackingRoute<{ id: string }>('reprint_void', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { unit: await voidUnit(actor, params.id, body.reason) }
})
