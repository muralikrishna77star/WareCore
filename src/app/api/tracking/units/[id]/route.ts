import { trackingRoute } from '@/lib/tracking/http'
import { unitParts } from '@/lib/tracking/floor'
import { getUnitDetail } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ actor, params }) => ({
  ...(await getUnitDetail(actor, params.id)),
  parts: await unitParts(actor, params.id),
}))
