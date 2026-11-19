import { readJson, trackingRoute } from '@/lib/tracking/http'
import { returnFromVendor } from '@/lib/tracking/jobwork'

export const POST = trackingRoute<{ id: string }>('operate', async ({ request, actor, params }) => {
  const body = await readJson(request)
  return { unit: await returnFromVendor(actor, params.id, body) }
})
