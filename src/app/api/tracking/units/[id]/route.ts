import { trackingRoute } from '@/lib/tracking/http'
import { getUnitDetail } from '@/lib/tracking/service'

export const GET = trackingRoute<{ id: string }>('view', async ({ actor, params }) => getUnitDetail(actor, params.id))
