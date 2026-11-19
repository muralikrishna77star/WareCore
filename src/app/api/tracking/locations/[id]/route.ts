import { readJson, trackingRoute } from '@/lib/tracking/http'
import { requestLocationPrint, setLocationActive } from '@/lib/tracking/floor'

export const PATCH = trackingRoute<{ id: string }>('manage', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { location: await setLocationActive(actor, params.id, body.is_active) }
})

/** Prints this location's label. */
export const POST = trackingRoute<{ id: string }>('manage', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return requestLocationPrint(actor, params.id, body.printer_id)
})
