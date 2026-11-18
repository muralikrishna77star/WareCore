import { readJson, trackingRoute } from '@/lib/tracking/http'
import { lookupCode } from '@/lib/tracking/service'

// POST because a lookup adds a scan event to the unit's history. It never changes stock.
export const POST = trackingRoute('view', async ({ request, actor }) => {
  const body = await readJson(request)
  return lookupCode(actor, body.code)
})
